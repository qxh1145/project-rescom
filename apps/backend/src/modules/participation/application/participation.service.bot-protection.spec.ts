import { ParticipationService } from './participation.service';
import { ParticipationRateLimiter } from './participation-rate-limiter';
import {
  InvalidCompletionCodeException,
  ParticipationRateLimitedException,
  SubmissionTooFastException,
  SurveyNotAvailableException,
} from './exceptions/participation.exceptions';
import { InMemoryParticipationRepository } from '../infrastructure/in-memory-participation.repository';
import { InMemoryFormRepository } from '../../forms/infrastructure/in-memory-form.repository';
import { InMemoryDemographicProfileRepository } from '../../users/infrastructure/in-memory-demographic-profile.repository';
import { InMemoryRateLimitCounterStore } from '../../../common/security/in-memory-rate-limit-counter.store';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';
import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import { seedCompleteDemographicProfile } from '../../../../test/fixtures/demographic-profile.fixture';

/**
 * Story 8.2 — Automated Bot Protection at the service level (FR-28, FR-45,
 * FR-46): server-authoritative Time Barrier from the pinned FormVersion,
 * structured rejection, once-per-attempt/window evidence, rate limits that
 * never consume the attempt.
 */
describe('ParticipationService bot protection (Story 8.2)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const publisherId = '22222222-2222-4222-8222-222222222222';
  const internalFormId = '33333333-3333-4333-8333-333333333333';
  const internalVersionId = '44444444-4444-4444-8444-444444444444';
  const externalFormId = '55555555-5555-4555-8555-555555555555';
  const externalVersionId = '66666666-6666-4666-8666-666666666666';

  const FIVE_QUESTIONS = [
    { id: 'q1', order: 0, title: 'Major', type: 'text', required: true },
    { id: 'q2', order: 1, title: 'Year', type: 'number', required: false },
    {
      id: 'q3',
      order: 2,
      title: 'Rating',
      type: 'rating',
      required: false,
      maxRating: 5,
    },
    { id: 'q4', order: 3, title: 'Comment', type: 'textarea', required: false },
    {
      id: 'q5',
      order: 4,
      title: 'Campus',
      type: 'single_choice',
      required: false,
      options: [
        { id: 'o1', label: 'A', value: 'a' },
        { id: 'o2', label: 'B', value: 'b' },
      ],
    },
  ];
  const VALID_ANSWERS = { q1: 'Software Engineering' };

  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let partRepo: InMemoryParticipationRepository;
  let completionCode: {
    verifyCode: jest.Mock;
    generateSixDigitCode: jest.Mock;
    canVerify: jest.Mock;
  };

  function internalVersion(
    id: string,
    blocks: unknown[],
    minTimeBarrierSeconds: number,
    versionNumber = 1,
  ) {
    return new FormVersionEntity(
      id,
      internalFormId,
      versionNumber,
      {
        title: 'Internal survey',
        metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds },
        blocks,
      } as any,
      null,
      true,
      null,
      null,
      new Date(),
      new Date(),
    );
  }

  async function seedForms(options: { internalMinimum?: number } = {}) {
    await formRepo.create(
      new FormEntity(
        internalFormId,
        publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Internal survey',
        null,
        10,
        50,
        new Date(),
        new Date(),
      ),
      internalVersion(
        internalVersionId,
        FIVE_QUESTIONS,
        options.internalMinimum ?? 4,
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
        10,
        50,
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
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 20 },
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

  function createService(rateLimiter?: ParticipationRateLimiter) {
    return new ParticipationService(
      formRepo,
      demoRepo,
      partRepo,
      undefined,
      completionCode as any,
      undefined,
      new PassThroughUnitOfWork(),
      undefined,
      rateLimiter,
    );
  }

  function backdate(attemptId: string, seconds: number) {
    const attempt = partRepo.attempts.get(attemptId)!;
    partRepo.attempts.set(
      attemptId,
      new SurveyAttemptEntity(
        attempt.id,
        attempt.surveyId,
        attempt.formVersionId,
        attempt.respondentId,
        attempt.status,
        attempt.isGuest,
        new Date(attempt.startedAt.getTime() - seconds * 1000),
        attempt.submittedAt,
        attempt.clientContext,
        attempt.createdAt,
        attempt.updatedAt,
      ),
    );
  }

  function seedCompletion(id: string, minutesAgo: number) {
    const submittedAt = new Date(Date.now() - minutesAgo * 60_000);
    partRepo.attempts.set(
      id,
      new SurveyAttemptEntity(
        id,
        'other-form',
        'other-version',
        userId,
        'COMPLETED',
        false,
        new Date(submittedAt.getTime() - 60_000),
        submittedAt,
        null,
        submittedAt,
        submittedAt,
      ),
    );
  }

  beforeEach(async () => {
    formRepo = new InMemoryFormRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    partRepo = new InMemoryParticipationRepository();
    completionCode = {
      verifyCode: jest.fn().mockReturnValue(true),
      generateSixDigitCode: jest.fn(),
      canVerify: jest.fn().mockReturnValue(true),
    };
    await seedCompleteDemographicProfile(demoRepo, userId);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Internal Time Barrier (FR-45)', () => {
    it('announces the barrier when the attempt starts (5 questions x 2 s)', async () => {
      await seedForms();
      const attempt = await createService().startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );

      expect(attempt.timeBarrier).toEqual({
        requiredSeconds: 10,
        questionCount: 5,
        secondsPerQuestion: 2,
        earliestSubmitAt: new Date(
          new Date(attempt.startedAt).getTime() + 10_000,
        ).toISOString(),
        policyVersion: 'time-barrier-v1',
      });
    });

    it('rejects a too-fast submission with structured details, keeps the attempt and records one FraudLog entry', async () => {
      await seedForms();
      const service = createService();
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdate(attempt.attemptId, 3);

      const error = await service
        .submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
          // Client-supplied timing is never trusted.
          clientContext: {
            startedAt: '2020-01-01T00:00:00.000Z',
            elapsedMs: 999_999,
          },
        })
        .catch((e) => e);

      expect(error).toBeInstanceOf(SubmissionTooFastException);
      expect(error.details).toMatchObject({
        requiredSeconds: 10,
        elapsedSeconds: 3,
        remainingSeconds: 7,
        retryAfterSeconds: 7,
        questionCount: 5,
        secondsPerQuestion: 2,
        publisherMinimumSeconds: 4,
        policyVersion: 'time-barrier-v1',
      });
      expect(partRepo.attempts.get(attempt.attemptId)?.status).toBe(
        'IN_PROGRESS',
      );
      expect(partRepo.responses.get(attempt.responseId!)?.status).toBe(
        'IN_PROGRESS',
      );
      expect(partRepo.outboxEvents).toHaveLength(0);

      // A second too-fast try is rejected again but logged only once.
      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).rejects.toBeInstanceOf(SubmissionTooFastException);
      expect(partRepo.fraudLogs).toHaveLength(1);
      expect(partRepo.fraudLogs[0]).toMatchObject({
        userId,
        type: 'TIME_BARRIER',
        dedupeKey: `time-barrier:${attempt.attemptId}`,
        details: expect.objectContaining({
          source: 'INTERNAL_SUBMISSION',
          attemptId: attempt.attemptId,
          responseId: attempt.responseId,
          formId: internalFormId,
          formVersionId: internalVersionId,
          elapsedSeconds: 3,
          requiredSeconds: 10,
          questionCount: 5,
        }),
      });
    });

    it('accepts the same attempt once enough time has passed and forwards the timing evidence', async () => {
      await seedForms();
      const service = createService();
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).rejects.toBeInstanceOf(SubmissionTooFastException);

      backdate(attempt.attemptId, 12);
      const result = await service.submitInternalResponse(
        attempt.responseId!,
        userId,
        { answers: VALID_ANSWERS },
      );

      expect(result.status).toBe('VALIDATED');
      const assessment = partRepo.outboxEvents.find(
        (event) => event.eventType === 'IntegrityAssessmentRequested',
      );
      expect(assessment?.payload.securityEvidence).toEqual({
        timeBarrier: {
          policyVersion: 'time-barrier-v1',
          requiredSeconds: 10,
          elapsedSeconds: 12,
          questionCount: 5,
        },
      });
    });

    it('accepts exactly number_of_questions x 2 seconds and rejects 1 ms earlier (boundary)', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-26T10:00:00.000Z') });
      await seedForms({ internalMinimum: 1 });
      const service = createService();
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );

      jest.setSystemTime(new Date('2026-09-26T10:00:09.999Z'));
      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).rejects.toMatchObject({
        details: expect.objectContaining({
          requiredSeconds: 10,
          remainingSeconds: 1,
        }),
      });

      jest.setSystemTime(new Date('2026-09-26T10:00:10.000Z'));
      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).resolves.toMatchObject({ status: 'VALIDATED' });
    });

    it('keeps a stricter publisher minimum', async () => {
      await seedForms({ internalMinimum: 30 });
      const service = createService();
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdate(attempt.attemptId, 20);

      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).rejects.toMatchObject({
        details: expect.objectContaining({
          requiredSeconds: 30,
          remainingSeconds: 10,
        }),
      });
    });

    it('checks the barrier before answer validation (bot junk still leaves evidence)', async () => {
      await seedForms();
      const service = createService();
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );

      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: { unknown: 'junk' },
        }),
      ).rejects.toBeInstanceOf(SubmissionTooFastException);
      expect(partRepo.fraudLogs).toHaveLength(1);
    });

    it('uses the pinned FormVersion even after a newer version went live', async () => {
      await seedForms({ internalMinimum: 1 });
      const service = createService();
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      const current = await formRepo.findById(internalFormId);
      await formRepo.update(
        current!.form,
        internalVersion(
          '77777777-7777-4777-8777-777777777777',
          [
            {
              id: 'only',
              order: 0,
              title: 'Only',
              type: 'text',
              required: true,
            },
          ],
          1,
          2,
        ),
      );
      backdate(attempt.attemptId, 3);

      // Barrier from v1 (5 questions -> 10 s), not v2 (1 question -> 2 s).
      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).rejects.toMatchObject({
        details: expect.objectContaining({ requiredSeconds: 10 }),
      });

      backdate(attempt.attemptId, 10);
      const result = await service.submitInternalResponse(
        attempt.responseId!,
        userId,
        { answers: VALID_ANSWERS },
      );
      expect(result.formVersionId).toBe(internalVersionId);
    });

    it('rejects a too-fast guest response without writing FraudLog (no user)', async () => {
      await seedForms();
      const { response } = await partRepo.createAttemptWithResponse({
        attemptId: '88888888-8888-4888-8888-888888888888',
        formId: internalFormId,
        formVersionId: internalVersionId,
        respondentId: null,
        isGuest: true,
        formType: 'INTERNAL',
        ipAddress: '127.0.0.1',
        startedAt: new Date(),
      });

      await expect(
        createService().submitInternalResponse(response!.id, null, {
          answers: VALID_ANSWERS,
        }),
      ).rejects.toBeInstanceOf(SubmissionTooFastException);
      expect(partRepo.fraudLogs).toHaveLength(0);
    });

    it('still rejects when the evidence cannot be written', async () => {
      await seedForms();
      const service = createService();
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      jest
        .spyOn(partRepo, 'recordFraudLog')
        .mockRejectedValue(new Error('db down'));

      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).rejects.toBeInstanceOf(SubmissionTooFastException);
    });
  });

  describe('External Time Barrier (Story 5.5 value, Story 8.2 contract)', () => {
    it('returns structured details and logs one entry per attempt', async () => {
      await seedForms();
      const service = createService();
      const attempt = await service.startAttempt(
        externalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      expect(attempt.timeBarrier).toMatchObject({
        requiredSeconds: 20,
        questionCount: null,
        secondsPerQuestion: null,
      });
      backdate(attempt.attemptId, 5);

      for (let i = 0; i < 2; i++) {
        await expect(
          service.verifyExternalCompletionCode(
            externalFormId,
            attempt.attemptId,
            userId,
            { completionCode: '123456' },
          ),
        ).rejects.toMatchObject({
          code: 'SUBMISSION_TOO_FAST',
          details: expect.objectContaining({
            requiredSeconds: 20,
            elapsedSeconds: 5,
            remainingSeconds: 15,
            questionCount: null,
          }),
        });
      }
      expect(
        partRepo.fraudLogs.filter((log) => log.type === 'TIME_BARRIER'),
      ).toHaveLength(1);
      expect(partRepo.attempts.get(attempt.attemptId)?.status).toBe(
        'IN_PROGRESS',
      );
    });
  });

  describe('Corrupt stored minimum (Epic 8 review P11)', () => {
    // Fails the definition parse (metadata max 86400), so the barrier falls
    // back to the raw stored JSON.
    const corruptSchema = { metadata: { minTimeBarrierSeconds: 1e20 } };

    async function seedCorruptForm(type: 'INTERNAL' | 'EXTERNAL') {
      const formId = type === 'INTERNAL' ? internalFormId : externalFormId;
      const versionId =
        type === 'INTERNAL' ? internalVersionId : externalVersionId;
      await formRepo.create(
        new FormEntity(
          formId,
          publisherId,
          type,
          'PUBLISHED',
          'Corrupt survey',
          null,
          10,
          50,
          new Date(),
          new Date(),
        ),
        new FormVersionEntity(
          versionId,
          formId,
          1,
          corruptSchema as any,
          null,
          true,
          type === 'EXTERNAL'
            ? 'https://docs.google.com/forms/d/e/abc/viewform'
            : null,
          type === 'EXTERNAL' ? 'v1:digest' : null,
          new Date(),
          new Date(),
        ),
      );
      return formId;
    }

    it('starts an External attempt and rejects its code with a structured 422, never a RangeError', async () => {
      const formId = await seedCorruptForm('EXTERNAL');
      const service = createService();

      const attempt = await service.startAttempt(
        formId,
        userId,
        {},
        '127.0.0.1',
      );
      expect(attempt.timeBarrier?.requiredSeconds).toBe(86_400);
      expect(attempt.timeBarrier?.earliestSubmitAt).toBe(
        new Date(
          new Date(attempt.startedAt).getTime() + 86_400_000,
        ).toISOString(),
      );

      const error = await service
        .verifyExternalCompletionCode(formId, attempt.attemptId, userId, {
          completionCode: '123456',
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SubmissionTooFastException);
      expect((error as SubmissionTooFastException).details).toMatchObject({
        requiredSeconds: 86_400,
        publisherMinimumSeconds: 86_400,
      });
      expect(completionCode.verifyCode).not.toHaveBeenCalled();
    });

    it('starts an Internal attempt; its submit fails closed on the unparseable definition, never a RangeError', async () => {
      const formId = await seedCorruptForm('INTERNAL');
      const service = createService();

      const attempt = await service.startAttempt(
        formId,
        userId,
        {},
        '127.0.0.1',
      );
      expect(attempt.timeBarrier?.requiredSeconds).toBe(86_400);

      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).rejects.toBeInstanceOf(SurveyNotAvailableException);
      expect(partRepo.attempts.get(attempt.attemptId)?.status).toBe(
        'IN_PROGRESS',
      );
    });
  });

  describe('Rate limits (FR-46)', () => {
    const policy = {
      completionLimit: 2,
      completionWindowSeconds: 3600,
      burstLimit: 3,
      burstWindowSeconds: 60,
    };
    let limiter: ParticipationRateLimiter;

    beforeEach(() => {
      limiter = new ParticipationRateLimiter(
        new InMemoryRateLimitCounterStore(),
        partRepo,
        policy,
      );
    });

    it('blocks starting a new attempt once the completion limit is reached', async () => {
      await seedForms();
      seedCompletion('done-1', 30);
      seedCompletion('done-2', 5);

      await expect(
        createService(limiter).startAttempt(
          internalFormId,
          userId,
          {},
          '127.0.0.1',
        ),
      ).rejects.toMatchObject({
        code: 'PARTICIPATION_RATE_LIMITED',
        details: expect.objectContaining({
          scope: 'COMPLETIONS',
          limit: 2,
          retryAfterSeconds: 30 * 60,
        }),
      });
      expect(
        [...partRepo.attempts.values()].filter(
          (a) => a.status === 'IN_PROGRESS',
        ),
      ).toHaveLength(0);
      expect(partRepo.fraudLogs).toEqual([
        expect.objectContaining({ type: 'RATE_LIMIT' }),
      ]);
    });

    it('keeps the in-transaction backstop: a completion over the limit (reservation bypassed, e.g. an attempt started before decision E8-D6) is refused without consuming the attempt; replays stay idempotent', async () => {
      await seedForms();
      const service = createService(limiter);
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdate(attempt.attemptId, 60);
      // Completions made elsewhere after this attempt started.
      seedCompletion('done-1', 0.5);
      seedCompletion('done-2', 0.2);

      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).rejects.toBeInstanceOf(ParticipationRateLimitedException);
      expect(partRepo.attempts.get(attempt.attemptId)?.status).toBe(
        'IN_PROGRESS',
      );

      partRepo.attempts.delete('done-2');
      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).resolves.toMatchObject({ status: 'VALIDATED' });

      // Now at the limit again, but an idempotent replay is never blocked.
      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).resolves.toMatchObject({ status: 'VALIDATED' });
    });

    it('limits request bursts per user on the submission endpoint', async () => {
      await seedForms();
      const service = createService(limiter);
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      for (let i = 0; i < 3; i++) {
        await service
          .submitInternalResponse(attempt.responseId!, userId, {
            answers: VALID_ANSWERS,
          })
          .catch(() => undefined);
      }

      await expect(
        service.submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        }),
      ).rejects.toMatchObject({
        code: 'PARTICIPATION_RATE_LIMITED',
        details: expect.objectContaining({ scope: 'INTERNAL_SUBMISSION' }),
      });
      // Epic 8 review P4: the evidence names the requested response.
      expect(
        partRepo.fraudLogs.filter((log) => log.type === 'RATE_LIMIT'),
      ).toEqual([
        expect.objectContaining({
          details: expect.objectContaining({
            requestedResponseId: attempt.responseId,
          }),
        }),
      ]);
    });

    it('records the requested form, response and attempt of a form-endpoint submission burst', async () => {
      await seedForms();
      const service = createService(limiter);
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      const input = {
        answers: VALID_ANSWERS,
        responseId: attempt.responseId!,
        attemptId: attempt.attemptId,
      };
      for (let i = 0; i < 4; i++) {
        await service
          .submitInternalResponse(internalFormId, userId, input, false)
          .catch(() => undefined);
      }

      expect(
        partRepo.fraudLogs.filter((log) => log.type === 'RATE_LIMIT'),
      ).toEqual([
        expect.objectContaining({
          details: expect.objectContaining({
            scope: 'INTERNAL_SUBMISSION',
            requestedFormId: internalFormId,
            requestedResponseId: attempt.responseId,
            requestedAttemptId: attempt.attemptId,
          }),
        }),
      ]);
    });

    it('does not rate limit guest responses per user', async () => {
      await seedForms();
      const { response } = await partRepo.createAttemptWithResponse({
        attemptId: '99999999-9999-4999-8999-999999999999',
        formId: internalFormId,
        formVersionId: internalVersionId,
        respondentId: null,
        isGuest: true,
        formType: 'INTERNAL',
        ipAddress: '127.0.0.1',
        startedAt: new Date(Date.now() - 60_000),
      });
      const transaction = jest.spyOn(
        partRepo,
        'submitInternalResponseTransaction',
      );

      await expect(
        createService(limiter).submitInternalResponse(response!.id, null, {
          answers: VALID_ANSWERS,
        }),
      ).resolves.toMatchObject({ status: 'VALIDATED' });
      // Epic 8 review P3: no per-user completion lock or re-check for guests.
      expect(transaction.mock.calls[0][0].completionLimit).toBeUndefined();
    });

    it('re-checks the limit inside the submit transaction: a completion raced in after the pre-check gives 429 COMPLETIONS, nothing consumed, one evidence entry (Epic 8 review P3)', async () => {
      await seedForms();
      const service = createService(limiter);
      const attempt = await service.startAttempt(
        internalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdate(attempt.attemptId, 60);
      const transaction =
        partRepo.submitInternalResponseTransaction.bind(partRepo);
      const spy = jest
        .spyOn(partRepo, 'submitInternalResponseTransaction')
        .mockImplementation(async (params) => {
          // Parallel completions on other surveys commit after the pre-check.
          seedCompletion('raced-1', 0.2);
          seedCompletion('raced-2', 0.1);
          return transaction(params);
        });

      const error = await service
        .submitInternalResponse(attempt.responseId!, userId, {
          answers: VALID_ANSWERS,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ParticipationRateLimitedException);
      expect(
        (error as ParticipationRateLimitedException).details,
      ).toMatchObject({ scope: 'COMPLETIONS', limit: 2, windowSeconds: 3600 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          completionLimit: expect.objectContaining({
            userId,
            limit: 2,
            windowSeconds: 3600,
          }),
        }),
      );
      expect(partRepo.attempts.get(attempt.attemptId)?.status).toBe(
        'IN_PROGRESS',
      );
      expect(partRepo.responses.get(attempt.responseId!)?.status).toBe(
        'IN_PROGRESS',
      );
      expect(partRepo.outboxEvents).toHaveLength(0);
      expect(partRepo.fraudLogs).toEqual([
        expect.objectContaining({
          type: 'RATE_LIMIT',
          details: expect.objectContaining({
            scope: 'COMPLETIONS',
            blockedAction: 'INTERNAL_SUBMISSION',
            attemptId: attempt.attemptId,
          }),
        }),
      ]);
    });

    it('decision E8-D6: code verification no longer pre-checks the limit (capacity was reserved at start)', async () => {
      await seedForms();
      const service = createService(limiter);
      const startCheck = jest.spyOn(limiter, 'assertStartCapacity');
      const attempt = await service.startAttempt(
        externalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdate(attempt.attemptId, 60);
      // Completions that bypassed the reservation (legacy attempts).
      seedCompletion('done-1', 1);
      seedCompletion('done-2', 1);
      completionCode.verifyCode.mockReturnValue(false);

      // The wrong code is judged normally: no 429 before the comparison.
      await expect(
        service.verifyExternalCompletionCode(
          externalFormId,
          attempt.attemptId,
          userId,
          { completionCode: '000000' },
        ),
      ).rejects.toBeInstanceOf(InvalidCompletionCodeException);
      expect(completionCode.verifyCode).toHaveBeenCalledTimes(1);
      expect(startCheck).toHaveBeenCalledTimes(1);
    });

    describe('decision E8-D6: completion capacity is reserved at attempt start', () => {
      it('refuses a start when completions + open attempts reach the limit; the open attempt still completes', async () => {
        await seedForms();
        const service = createService(limiter);
        seedCompletion('done-1', 10);
        const openAttempt = await service.startAttempt(
          internalFormId,
          userId,
          {},
          '127.0.0.1',
        );

        // 1 completion + 1 open attempt = the limit of 2.
        const refused = await service
          .startAttempt(externalFormId, userId, {}, '127.0.0.1')
          .catch((e: unknown) => e);
        expect(refused).toBeInstanceOf(ParticipationRateLimitedException);
        expect(
          (refused as ParticipationRateLimitedException).details,
        ).toMatchObject({
          scope: 'COMPLETIONS',
          limit: 2,
          completionsInWindow: 1,
          inProgressAttempts: 1,
          // The open attempt's reservation expires first (30 min).
          retryAfterSeconds: 30 * 60,
        });
        expect(
          [...partRepo.attempts.values()].filter(
            (a) => a.surveyId === externalFormId,
          ),
        ).toHaveLength(0);
        expect(partRepo.fraudLogs).toEqual([
          expect.objectContaining({
            type: 'RATE_LIMIT',
            details: expect.objectContaining({
              blockedAction: 'ATTEMPT_START',
              inProgressAttempts: 1,
            }),
          }),
        ]);

        // The honest respondent never loses the finished work.
        backdate(openAttempt.attemptId, 60);
        await expect(
          service.submitInternalResponse(openAttempt.responseId!, userId, {
            answers: VALID_ANSWERS,
          }),
        ).resolves.toMatchObject({ status: 'VALIDATED' });
      });

      it('an expired attempt releases its reservation', async () => {
        await seedForms();
        const service = createService(limiter);
        seedCompletion('done-1', 10);
        const stale = await service.startAttempt(
          internalFormId,
          userId,
          {},
          '127.0.0.1',
        );
        backdate(stale.attemptId, 31 * 60);

        await expect(
          service.startAttempt(externalFormId, userId, {}, '127.0.0.1'),
        ).resolves.toMatchObject({ status: 'IN_PROGRESS' });
      });

      it('passes the reservation to the start transaction and reports a raced refusal after it (nothing written)', async () => {
        await seedForms();
        const service = createService(limiter);
        seedCompletion('done-1', 10);
        const reserve = partRepo.reserveAttempt.bind(partRepo);
        const spy = jest
          .spyOn(partRepo, 'reserveAttempt')
          .mockImplementation(async (params) => {
            // A parallel start on another survey commits after the pre-check.
            await partRepo.createAttemptWithResponse({
              attemptId: '77777777-7777-4777-8777-777777777777',
              formId: 'other-form',
              formVersionId: 'other-version',
              respondentId: userId,
              isGuest: false,
              formType: 'EXTERNAL',
              ipAddress: '127.0.0.1',
              startedAt: new Date(),
            });
            return reserve(params);
          });

        const error = await service
          .startAttempt(externalFormId, userId, {}, '127.0.0.1')
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ParticipationRateLimitedException);
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            completionReservation: expect.objectContaining({
              userId,
              limit: 2,
              windowSeconds: 3600,
            }),
          }),
        );
        expect(
          [...partRepo.attempts.values()].filter(
            (a) => a.surveyId === externalFormId,
          ),
        ).toHaveLength(0);
        expect(partRepo.fraudLogs).toEqual([
          expect.objectContaining({
            type: 'RATE_LIMIT',
            details: expect.objectContaining({
              completionsInWindow: 1,
              inProgressAttempts: 1,
            }),
          }),
        ]);
      });

      it('never reserves for guests', async () => {
        await seedForms();
        const spy = jest.spyOn(partRepo, 'reserveAttempt');
        await createService(limiter).startAttempt(
          internalFormId,
          null,
          {},
          '127.0.0.1',
        );
        expect(spy.mock.calls[0][0].completionReservation).toBeUndefined();
      });
    });

    it('re-checks the limit inside the claim: a raced completion gives 429 after a valid code, without a strike, and the evidence is written after the Unit of Work (Epic 8 review P3)', async () => {
      await seedForms();
      let inUnitOfWork = false;
      const unitOfWork = {
        run: async <T>(_key: string, work: () => Promise<T>): Promise<T> => {
          inUnitOfWork = true;
          try {
            return await work();
          } finally {
            inUnitOfWork = false;
          }
        },
      };
      const service = new ParticipationService(
        formRepo,
        demoRepo,
        partRepo,
        undefined,
        completionCode as any,
        undefined,
        unitOfWork,
        undefined,
        limiter,
      );
      const attempt = await service.startAttempt(
        externalFormId,
        userId,
        {},
        '127.0.0.1',
      );
      backdate(attempt.attemptId, 60);
      const lock = jest.spyOn(partRepo, 'lockAttemptForVerification');
      const claim = partRepo.completeExternalAttemptTransaction.bind(partRepo);
      jest
        .spyOn(partRepo, 'completeExternalAttemptTransaction')
        .mockImplementation(async (params) => {
          seedCompletion('raced-1', 0.2);
          seedCompletion('raced-2', 0.1);
          return claim(params);
        });
      const recordFraudLog = partRepo.recordFraudLog.bind(partRepo);
      const evidenceInsideUnitOfWork: boolean[] = [];
      jest
        .spyOn(partRepo, 'recordFraudLog')
        .mockImplementation(async (...args) => {
          evidenceInsideUnitOfWork.push(inUnitOfWork);
          return recordFraudLog(...args);
        });

      const error = await service
        .verifyExternalCompletionCode(
          externalFormId,
          attempt.attemptId,
          userId,
          {
            completionCode: '123456',
          },
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ParticipationRateLimitedException);
      expect((error as ParticipationRateLimitedException).details.scope).toBe(
        'COMPLETIONS',
      );
      // The valid code was judged, under the user's completion lock.
      expect(completionCode.verifyCode).toHaveBeenCalledTimes(1);
      expect(lock).toHaveBeenCalledWith(
        attempt.attemptId,
        externalFormId,
        userId,
      );
      const stored = partRepo.attempts.get(attempt.attemptId);
      expect(stored?.status).toBe('IN_PROGRESS');
      expect(stored?.codeVerification.failedCount).toBe(0);
      expect(
        partRepo.fraudLogs.filter((log) => log.type === 'SECURITY_VIOLATION'),
      ).toHaveLength(0);
      expect(
        partRepo.fraudLogs.filter((log) => log.type === 'RATE_LIMIT'),
      ).toEqual([
        expect.objectContaining({
          details: expect.objectContaining({
            scope: 'COMPLETIONS',
            blockedAction: 'COMPLETION_CODE',
            attemptId: attempt.attemptId,
          }),
        }),
      ]);
      expect(evidenceInsideUnitOfWork).toEqual([false]);
    });
  });
});
