import { randomUUID } from 'crypto';
import { ParticipationService } from './participation.service';
import {
  AttemptExpiredException,
  AttemptLockedException,
  ConflictingActiveAttemptException,
  InvalidCompletionCodeException,
  InvalidFormSubmissionException,
  SurveyAlreadyCompletedException,
  SurveyNotAvailableException,
  SurveyQuotaFullException,
  UncleanAttachmentException,
} from './exceptions/participation.exceptions';
import { InMemoryParticipationRepository } from '../infrastructure/in-memory-participation.repository';
import { InMemoryFormRepository } from '../../forms/infrastructure/in-memory-form.repository';
import { InMemoryDemographicProfileRepository } from '../../users/infrastructure/in-memory-demographic-profile.repository';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';
import { ResponseEntity } from '../domain/response.entity';
import {
  PassThroughUnitOfWork,
  UnitOfWorkPort,
} from '../../../common/database/unit-of-work.port';
import { seedCompleteDemographicProfile } from '../../../../test/fixtures/demographic-profile.fixture';
import { backdateAttempt } from '../../../../test/fixtures/participation.fixture';

/**
 * Epic 5 code review (2026-09-26): attempt-start concurrency (P1), server-owned
 * security counters (P2), the file-answer contract and verified attachments
 * (P3/P4), serialized completion-code checks (P6), state-predicated Internal
 * submission (P7), unverifiable verifiers (P9), journal-based External replay
 * (P19) and in-memory quota fidelity (P28). PostgreSQL-level proofs (row
 * locks, partial unique indexes) belong to the Postgres-gated suite (DF5).
 */
describe('ParticipationService — Epic 5 review', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const publisherId = '22222222-2222-4222-8222-222222222222';
  const internalFormId = '33333333-3333-4333-8333-333333333333';
  const internalVersionId = '44444444-4444-4444-8444-444444444444';
  const externalFormId = '55555555-5555-4555-8555-555555555555';
  const externalVersionId = '66666666-6666-4666-8666-666666666666';
  const RIGHT_CODE = '111111';

  /** Runs units of work one after another, like the attempt row lock. */
  class SerializingUnitOfWork implements UnitOfWorkPort {
    private tail: Promise<unknown> = Promise.resolve();

    run<T>(_key: string, work: () => Promise<T>): Promise<T> {
      const next = this.tail.then(() => work());
      this.tail = next.catch(() => undefined);
      return next;
    }
  }

  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let partRepo: InMemoryParticipationRepository;
  let completionCode: {
    verifyCode: jest.Mock;
    canVerify: jest.Mock;
    generateSixDigitCode: jest.Mock;
  };
  let coordinator: {
    settleExternalReward: jest.Mock;
    findExternalSettlement: jest.Mock;
    settleInternalReward: jest.Mock;
    findInternalSettlement: jest.Mock;
  };

  const FILE_BLOCK = {
    id: 'q-file',
    order: 1,
    title: 'Evidence',
    type: 'file_upload',
    required: false,
    maxFileSizeMb: 5,
    allowedMimeTypes: ['application/pdf', 'image/png'],
    maxFiles: 2,
  };
  const OTHER_FILE_BLOCK = { ...FILE_BLOCK, id: 'q-file-2', order: 2 };
  const BLOCKS = [
    { id: 'q-text', order: 0, title: 'Name', type: 'text', required: true },
    FILE_BLOCK,
    OTHER_FILE_BLOCK,
  ];

  async function seedForms(expectedCompletions = 50, rewardPerResponse = 10) {
    await formRepo.create(
      new FormEntity(
        internalFormId,
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Internal survey',
        null,
        rewardPerResponse,
        expectedCompletions,
        new Date(),
        new Date(),
      ),
      new FormVersionEntity(
        internalVersionId,
        internalFormId,
        1,
        {
          title: 'Internal survey',
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 1 },
          blocks: BLOCKS,
        } as any,
        null,
        true,
        null,
        null,
        new Date(),
        new Date(),
      ),
    );
    await formRepo.create(
      new FormEntity(
        externalFormId,
        publisherId,
        'EXTERNAL',
        'PUBLISHED',
        'External survey',
        null,
        rewardPerResponse,
        expectedCompletions,
        new Date(),
        new Date(),
      ),
      new FormVersionEntity(
        externalVersionId,
        externalFormId,
        1,
        {
          title: 'External survey',
          blocks: [],
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
        } as any,
        null,
        true,
        'https://docs.google.com/forms/d/e/abc/viewform',
        'v1:digest',
        new Date(),
        new Date(),
      ),
    );
  }

  function createService(
    unitOfWork: UnitOfWorkPort = new PassThroughUnitOfWork(),
  ) {
    return new ParticipationService(
      formRepo,
      demoRepo,
      partRepo,
      coordinator as any,
      completionCode as any,
      undefined,
      unitOfWork,
    );
  }

  beforeEach(async () => {
    formRepo = new InMemoryFormRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    partRepo = new InMemoryParticipationRepository();
    completionCode = {
      verifyCode: jest.fn(
        (_version: string, candidate: string) => candidate === RIGHT_CODE,
      ),
      canVerify: jest.fn().mockReturnValue(true),
      generateSixDigitCode: jest.fn(),
    };
    coordinator = {
      settleExternalReward: jest.fn(async (params) => ({
        status: 'PENDING',
        journalId: randomUUID(),
        amount: params.rewardPerResponse,
        targetAccountClass: 'PENDING',
        settledAt: new Date().toISOString(),
      })),
      findExternalSettlement: jest.fn().mockResolvedValue(null),
      settleInternalReward: jest.fn(async (params) => ({
        status: 'SETTLED',
        journalId: randomUUID(),
        amount: params.rewardPerResponse,
        targetAccountClass: 'USER_AVAILABLE',
        settledAt: new Date().toISOString(),
      })),
      findInternalSettlement: jest.fn().mockResolvedValue(null),
    };
    await seedCompleteDemographicProfile(demoRepo, userId);
  });

  describe('P1 — atomic attempt start', () => {
    it('10 parallel starts by one account create exactly one attempt; the rest get 409', async () => {
      await seedForms();
      const service = createService();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          service.startAttempt(internalFormId, userId, {}, '127.0.0.1'),
        ),
      );

      const created = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(created).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      for (const failure of rejected) {
        expect(failure.reason).toBeInstanceOf(
          ConflictingActiveAttemptException,
        );
      }
      expect(
        Array.from(partRepo.attempts.values()).filter(
          (attempt) => attempt.status === 'IN_PROGRESS',
        ),
      ).toHaveLength(1);
    });

    it('N+5 parallel accounts on a quota-N form reserve exactly N slots', async () => {
      const quota = 3;
      await seedForms(quota);
      const users = Array.from({ length: quota + 5 }, () => randomUUID());
      for (const id of users) {
        await seedCompleteDemographicProfile(demoRepo, id);
      }
      const service = createService();

      const results = await Promise.allSettled(
        users.map((id) =>
          service.startAttempt(internalFormId, id, {}, '127.0.0.1'),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
        quota,
      );
      for (const failure of results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )) {
        expect(failure.reason).toBeInstanceOf(SurveyQuotaFullException);
      }
    });

    it('refuses a start when the form closed after the pre-check (NOT_OPEN inside the reservation)', async () => {
      await seedForms();
      partRepo.formStatusLookup = () => 'CLOSED';

      await expect(
        createService().startAttempt(internalFormId, userId, {}, '127.0.0.1'),
      ).rejects.toBeInstanceOf(SurveyNotAvailableException);
      expect(partRepo.attempts.size).toBe(0);
    });
  });

  describe('P2 — server-owned completion-code counters', () => {
    async function startExternal(clientContext?: Record<string, unknown>) {
      await seedForms();
      const service = createService();
      const attempt = await service.startAttempt(
        externalFormId,
        userId,
        { clientContext: clientContext as any },
        '127.0.0.1',
      );
      backdateAttempt(partRepo, attempt.attemptId, 30);
      return { service, attempt };
    }

    it('ignores a client-seeded failedVerifications: the third wrong code still locks', async () => {
      const { service, attempt } = await startExternal({
        failedVerifications: -1_000_000,
      });

      const first = await service
        .verifyExternalCompletionCode(
          externalFormId,
          attempt.attemptId,
          userId,
          {
            completionCode: '000001',
          },
        )
        .catch((e) => e);
      expect(first).toBeInstanceOf(InvalidCompletionCodeException);
      expect(first.remainingAttempts).toBe(2);

      await service
        .verifyExternalCompletionCode(
          externalFormId,
          attempt.attemptId,
          userId,
          {
            completionCode: '000002',
          },
        )
        .catch(() => undefined);
      await expect(
        service.verifyExternalCompletionCode(
          externalFormId,
          attempt.attemptId,
          userId,
          { completionCode: '000003' },
        ),
      ).rejects.toBeInstanceOf(AttemptLockedException);

      const stored = partRepo.attempts.get(attempt.attemptId)!;
      expect(stored.status).toBe('LOCKED');
      expect(stored.codeVerification.failedCount).toBe(3);
      // The opaque client context is untouched and never used as a counter.
      expect(stored.clientContext).toEqual({ failedVerifications: -1_000_000 });
    });

    it('a pre-seeded reportedMissingCode in clientContext still produces exactly one Outbox row', async () => {
      const { service, attempt } = await startExternal();
      const current = partRepo.attempts.get(attempt.attemptId)!;
      partRepo.attempts.set(
        attempt.attemptId,
        new SurveyAttemptEntity(
          current.id,
          current.surveyId,
          current.formVersionId,
          current.respondentId,
          current.status,
          current.isGuest,
          current.startedAt,
          current.submittedAt,
          { reportedMissingCode: { reportedAt: '2020-01-01T00:00:00.000Z' } },
          current.createdAt,
          current.updatedAt,
        ),
      );

      const first = await service.reportMissingCompletionCode(
        externalFormId,
        attempt.attemptId,
        userId,
        { reason: 'No code was shown at the end' },
      );
      const second = await service.reportMissingCompletionCode(
        externalFormId,
        attempt.attemptId,
        userId,
        { reason: 'Reporting again' },
      );

      const reports = partRepo.outboxEvents.filter(
        (event) => event.eventType === 'ExternalCompletionCodeMissingReported',
      );
      expect(reports).toHaveLength(1);
      expect(second.reportedAt).toBe(first.reportedAt);
      expect(reports[0].payload).toMatchObject({
        reason: 'No code was shown at the end',
        requiredBarrierSeconds: 15,
        reservationExpired: false,
      });
    });
  });

  describe('P6 — serialized completion-code verification', () => {
    it('5 wrong codes and 1 right code in parallel record at most 3 strikes and give every locked reply the same body', async () => {
      await seedForms();
      const service = createService(new SerializingUnitOfWork());
      const attempt = await service.startAttempt(
        externalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdateAttempt(partRepo, attempt.attemptId, 30);

      const codes = [
        '000001',
        '000002',
        '000003',
        RIGHT_CODE,
        '000004',
        '000005',
      ];
      const results = await Promise.allSettled(
        codes.map((completionCode) =>
          service.verifyExternalCompletionCode(
            externalFormId,
            attempt.attemptId,
            userId,
            { completionCode },
          ),
        ),
      );

      const strikes = partRepo.fraudLogs.filter(
        (entry) => entry.type === 'SECURITY_VIOLATION',
      );
      expect(strikes.length).toBeLessThanOrEqual(3);
      expect(partRepo.attempts.get(attempt.attemptId)!.status).toBe('LOCKED');
      expect(coordinator.settleExternalReward).not.toHaveBeenCalled();

      const locked = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason)
        .filter((reason) => reason instanceof AttemptLockedException);
      // The right code arrived after the lock: its reply is indistinguishable.
      expect(locked.length).toBeGreaterThanOrEqual(3);
      expect(new Set(locked.map((error) => error.message)).size).toBe(1);
      expect(new Set(locked.map((error) => error.code)).size).toBe(1);
    });
  });

  describe('P9 — unusable verifier', () => {
    it('refuses verification without a strike or FraudLog entry', async () => {
      await seedForms();
      completionCode.canVerify.mockReturnValue(false);
      const service = createService();
      const attempt = await service.startAttempt(
        externalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdateAttempt(partRepo, attempt.attemptId, 30);

      await expect(
        service.verifyExternalCompletionCode(
          externalFormId,
          attempt.attemptId,
          userId,
          { completionCode: '123456' },
        ),
      ).rejects.toBeInstanceOf(SurveyNotAvailableException);

      expect(completionCode.verifyCode).not.toHaveBeenCalled();
      expect(partRepo.fraudLogs).toHaveLength(0);
      expect(
        partRepo.attempts.get(attempt.attemptId)!.codeVerification.failedCount,
      ).toBe(0);
    });

    it('treats a missing completion-code service the same way', async () => {
      await seedForms();
      const service = new ParticipationService(formRepo, demoRepo, partRepo);
      const attempt = await service.startAttempt(
        externalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdateAttempt(partRepo, attempt.attemptId, 30);

      await expect(
        service.verifyExternalCompletionCode(
          externalFormId,
          attempt.attemptId,
          userId,
          { completionCode: '123456' },
        ),
      ).rejects.toBeInstanceOf(SurveyNotAvailableException);
      expect(partRepo.fraudLogs).toHaveLength(0);
    });
  });

  describe('P19 — External replay returns the recorded journal', () => {
    it('replays the original amount after a price edit and never posts again', async () => {
      await seedForms();
      const service = createService();
      const attempt = await service.startAttempt(
        externalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdateAttempt(partRepo, attempt.attemptId, 30);
      await service.verifyExternalCompletionCode(
        externalFormId,
        attempt.attemptId,
        userId,
        { completionCode: RIGHT_CODE },
      );
      const posted =
        await coordinator.settleExternalReward.mock.results[0].value;
      coordinator.findExternalSettlement.mockResolvedValue(posted);
      coordinator.settleExternalReward.mockClear();
      // The publisher later raises the reward (e.g. in a new version).
      const { form } = (await formRepo.findById(externalFormId))!;
      (form as any).rewardPerResponse = 90;

      const replay = await service.verifyExternalCompletionCode(
        externalFormId,
        attempt.attemptId,
        userId,
        { completionCode: RIGHT_CODE },
      );

      expect(replay.reward.amount).toBe(10);
      expect(replay.reward.journalId).toBe(posted.journalId);
      expect(replay.message).toContain('+10');
      expect(coordinator.settleExternalReward).not.toHaveBeenCalled();
    });

    it('replays amount 0 when no journal was ever posted (reward 0 at completion)', async () => {
      await seedForms(50, 0);
      const service = createService();
      const attempt = await service.startAttempt(
        externalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdateAttempt(partRepo, attempt.attemptId, 30);
      await service.verifyExternalCompletionCode(
        externalFormId,
        attempt.attemptId,
        userId,
        { completionCode: RIGHT_CODE },
      );
      coordinator.settleExternalReward.mockClear();

      const replay = await service.verifyExternalCompletionCode(
        externalFormId,
        attempt.attemptId,
        userId,
        { completionCode: RIGHT_CODE },
      );

      expect(replay.reward).toMatchObject({ amount: 0, journalId: null });
      expect(coordinator.settleExternalReward).not.toHaveBeenCalled();
    });
  });

  describe('Internal submission (P3/P4/P7/P28)', () => {
    async function startInternal() {
      await seedForms();
      const service = createService();
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdateAttempt(partRepo, attempt.attemptId, 30);
      return { service, attempt };
    }

    function seedObject(
      attemptId: string,
      overrides: Partial<{
        id: string;
        ownerRecordId: string;
        questionId: string;
        status: string;
      }> = {},
    ) {
      const id = overrides.id ?? randomUUID();
      partRepo.storedObjects.set(id, {
        id,
        ownerContext: 'participation',
        ownerRecordId: overrides.ownerRecordId ?? attemptId,
        questionId: overrides.questionId ?? FILE_BLOCK.id,
        status: overrides.status ?? 'CLEAN',
      });
      return id;
    }

    function fileAnswer(objectId: string) {
      return {
        objectId,
        fileName: 'evidence.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        status: 'CLEAN' as const,
      };
    }

    it('accepts the real UI multi-file shape and attaches every owned CLEAN object', async () => {
      const { service, attempt } = await startInternal();
      const first = seedObject(attempt.attemptId);
      const second = seedObject(attempt.attemptId);

      const result = await service.submitInternalResponse(
        attempt.responseId!,
        userId,
        {
          answers: {
            'q-text': 'Ana',
            'q-file': [fileAnswer(first), fileAnswer(second)],
          },
        },
      );

      expect(result.status).toBe('VALIDATED');
      expect(partRepo.storedObjects.get(first)!.status).toBe('ATTACHED');
      expect(partRepo.storedObjects.get(second)!.status).toBe('ATTACHED');
    });

    it.each([
      ['QUARANTINED', { status: 'QUARANTINED' }],
      ['REJECTED', { status: 'REJECTED' }],
      ["another attempt's", { ownerRecordId: randomUUID() }],
      ["another question's", { questionId: OTHER_FILE_BLOCK.id }],
    ])(
      'rejects a %s object with UNCLEAN_ATTACHMENT and keeps the response IN_PROGRESS',
      async (_label, overrides) => {
        const { service, attempt } = await startInternal();
        const objectId = seedObject(attempt.attemptId, overrides);

        await expect(
          service.submitInternalResponse(attempt.responseId!, userId, {
            answers: { 'q-text': 'Ana', 'q-file': [fileAnswer(objectId)] },
          }),
        ).rejects.toBeInstanceOf(UncleanAttachmentException);
        expect(partRepo.responses.get(attempt.responseId!)!.status).toBe(
          'IN_PROGRESS',
        );
        expect(partRepo.outboxEvents).toHaveLength(0);
      },
    );

    it('rejects a missing object with UNCLEAN_ATTACHMENT', async () => {
      const { service, attempt } = await startInternal();
      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: { 'q-text': 'Ana', 'q-file': [fileAnswer(randomUUID())] },
        }),
      ).rejects.toBeInstanceOf(UncleanAttachmentException);
    });

    it.each([
      ['a bare string', 'not-a-file'],
      [
        'a non-UUID object id',
        [{ ...fileAnswer('x'), objectId: 'not-a-uuid' }],
      ],
      ['a builder-preview MockFileValue', [{ name: 'a.pdf', size: 10 }]],
      ['a single object instead of a list', fileAnswer(randomUUID())],
    ])('rejects %s with 400, never 500', async (_label, value) => {
      const { service, attempt } = await startInternal();
      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: { 'q-text': 'Ana', 'q-file': value },
        }),
      ).rejects.toBeInstanceOf(InvalidFormSubmissionException);
    });

    it('rejects one object referenced twice (400)', async () => {
      const { service, attempt } = await startInternal();
      const objectId = seedObject(attempt.attemptId);
      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: {
            'q-text': 'Ana',
            'q-file': [fileAnswer(objectId)],
            'q-file-2': [fileAnswer(objectId)],
          },
        }),
      ).rejects.toBeInstanceOf(InvalidFormSubmissionException);
    });

    it('two concurrent submits give one VALIDATED commit, one idempotent reply and exactly one Outbox pair', async () => {
      const { service, attempt } = await startInternal();

      const results = await Promise.all([
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: { 'q-text': 'Ana' },
        }),
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: { 'q-text': 'Ana' },
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual(['VALIDATED', 'VALIDATED']);
      expect(results[0].responseId).toBe(results[1].responseId);
      expect(
        partRepo.outboxEvents.filter(
          (e) => e.eventType === 'InternalRewardRequested',
        ),
      ).toHaveLength(1);
      expect(
        partRepo.outboxEvents.filter(
          (e) => e.eventType === 'IntegrityAssessmentRequested',
        ),
      ).toHaveLength(1);
      // P21: the reward event is a single-event stream per response.
      const reward = partRepo.outboxEvents.find(
        (e) => e.eventType === 'InternalRewardRequested',
      )!;
      expect(partRepo.outboxOrderingStreams.get(reward.id)).toBe(
        `internal-reward:${attempt.responseId}`,
      );
    });

    it('rejects an abandoned attempt with 409', async () => {
      const { service, attempt } = await startInternal();
      const current = partRepo.attempts.get(attempt.attemptId)!;
      partRepo.attempts.set(
        attempt.attemptId,
        new SurveyAttemptEntity(
          current.id,
          current.surveyId,
          current.formVersionId,
          current.respondentId,
          'ABANDONED',
          current.isGuest,
          current.startedAt,
          null,
          null,
          current.createdAt,
          new Date(),
        ),
      );

      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: { 'q-text': 'Ana' },
        }),
      ).rejects.toBeInstanceOf(AttemptExpiredException);
    });

    it('rejects mismatched responseId/attemptId with 400', async () => {
      const { service, attempt } = await startInternal();
      await expect(
        service.submitInternalResponse(
          internalFormId,
          userId,
          {
            responseId: attempt.responseId!,
            attemptId: randomUUID(),
            answers: { 'q-text': 'Ana' },
          },
          false,
        ),
      ).rejects.toBeInstanceOf(InvalidFormSubmissionException);
    });

    it('rejects a response under review (DISPUTED) with 409 instead of overwriting it', async () => {
      const { service, attempt } = await startInternal();
      const current = partRepo.responses.get(attempt.responseId!)!;
      partRepo.responses.set(
        current.id,
        new ResponseEntity(
          current.id,
          current.formId,
          current.formVersionId,
          current.attemptId,
          current.respondentId,
          'DISPUTED',
          { 'q-text': 'Old' },
          current.ipAddress,
          current.isGuest,
          new Date(),
          current.createdAt,
          new Date(),
        ),
      );

      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: { 'q-text': 'New' },
        }),
      ).rejects.toBeInstanceOf(SurveyAlreadyCompletedException);
      expect(partRepo.responses.get(current.id)!.answersJson).toEqual({
        'q-text': 'Old',
      });
    });

    it('P28: an Internal completion counts once toward the quota', async () => {
      const { service, attempt } = await startInternal();
      await service.submitInternalResponse(attempt.responseId!, userId, {
        answers: { 'q-text': 'Ana' },
      });

      await expect(
        partRepo.getQuotaStatus(internalFormId, new Date(0)),
      ).resolves.toEqual({ completedCount: 1, activeReservationCount: 0 });
    });
  });
});
