import { randomUUID } from 'crypto';
import {
  RESERVATION_EXPIRY_MS,
  attemptOutcomeSchema,
  cancelAttemptResponseSchema,
  surveyAttemptDetailsSchema,
  surveySummarySchema,
} from '@rescom/schemas';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import { InMemoryFormRepository } from '../../forms/infrastructure/in-memory-form.repository';
import { InMemoryDemographicProfileRepository } from '../../users/infrastructure/in-memory-demographic-profile.repository';
import { LedgerService } from '../../economy/application/ledger.service';
import { RewardSettlementCoordinator } from '../../economy/application/reward-settlement.coordinator';
import { StarterPointsCoordinator } from '../../economy/application/starter-points.coordinator';
import { InMemoryLedgerRepository } from '../../economy/infrastructure/in-memory-ledger.repository';
import { InMemoryStarterPointsDataProvider } from '../../economy/infrastructure/in-memory-starter-points-data-provider';
import {
  AttemptStatus,
  EMPTY_CODE_VERIFICATION_STATE,
  SurveyAttemptEntity,
} from '../domain/survey-attempt.entity';
import { InMemoryParticipationRepository } from '../infrastructure/in-memory-participation.repository';
import { economyAttemptRewardQueries } from '../infrastructure/economy-attempt-reward-query.adapter';
import { AttemptRewardQueryPort } from './ports/attempt-reward-query.port';
import { ParticipationService } from './participation.service';
import { SurveyRunnerReadService } from './survey-runner-read.service';
import {
  AttemptNotFoundException,
  AttemptNotInProgressException,
  SurveyNotFoundException,
} from './exceptions/participation.exceptions';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const ids = {
  publisher: '10000000-0000-4000-8000-000000000001',
  respondent: '10000000-0000-4000-8000-000000000002',
  other: '10000000-0000-4000-8000-000000000003',
  internalForm: '20000000-0000-4000-8000-000000000001',
  internalV1: '20000000-0000-4000-8000-000000000002',
  internalV2: '20000000-0000-4000-8000-000000000003',
  externalForm: '30000000-0000-4000-8000-000000000001',
  externalV1: '30000000-0000-4000-8000-000000000002',
  externalV2: '30000000-0000-4000-8000-000000000003',
};

const GOOGLE_V1 = 'https://docs.google.com/forms/d/e/v1/viewform';
const GOOGLE_V2 = 'https://docs.google.com/forms/d/e/v2/viewform';

function definition(questionIds: string[], minTimeBarrierSeconds = 20) {
  return {
    schemaVersion: 1,
    title: 'Thói quen tự học (bản đã ghim)',
    description: 'Mô tả của phiên bản',
    blocks: questionIds.map((id, order) => ({
      id,
      order,
      type: 'text',
      title: `Câu ${id}`,
      required: true,
    })),
    settings: {
      shuffleBlocks: false,
      progressBar: true,
      requireAuth: true,
      allowPublicAccess: false,
      submitButtonText: 'Nộp bài',
    },
    metadata: { expectedEffortSeconds: 300, minTimeBarrierSeconds },
  } as any;
}

function makeForm(
  id: string,
  type: 'INTERNAL' | 'EXTERNAL',
  overrides: Partial<{
    status: FormEntity['status'];
    estimatedDurationMinutes: number | null;
    expectedCompletions: number;
    rewardPerResponse: number;
    deadlineAt: Date;
  }> = {},
): FormEntity {
  return new FormEntity(
    id,
    ids.publisher,
    type,
    overrides.status ?? 'PUBLISHED',
    `${type} survey`,
    'Mô tả khảo sát',
    overrides.rewardPerResponse ?? 12,
    overrides.expectedCompletions ?? 3,
    new Date('2026-09-30T08:00:00.000Z'),
    new Date('2026-09-30T08:00:00.000Z'),
    undefined,
    0,
    overrides.estimatedDurationMinutes ?? null,
    null,
    overrides.deadlineAt ?? null,
  );
}

function makeVersion(
  id: string,
  formId: string,
  versionNumber: number,
  schemaJson: unknown,
  options: { isPublished?: boolean; externalUrl?: string | null } = {},
): FormVersionEntity {
  return new FormVersionEntity(
    id,
    formId,
    versionNumber,
    schemaJson as any,
    null,
    options.isPublished ?? true,
    options.externalUrl ?? null,
    null,
    new Date('2026-09-30T08:00:00.000Z'),
    new Date('2026-09-30T08:00:00.000Z'),
  );
}

function fakeRewards(): jest.Mocked<AttemptRewardQueryPort> {
  return {
    findInternalSettlement: jest.fn().mockResolvedValue(null),
    findExternalSettlement: jest.fn().mockResolvedValue(null),
    getExternalSettlementState: jest.fn().mockResolvedValue('NONE'),
    getActivationSnapshot: jest.fn().mockResolvedValue({
      unlockedAt: null,
      amount: null,
      activationSurvey: null,
    }),
  };
}

describe('Story IR.2a: SurveyRunnerReadService', () => {
  let clock: Date;
  let formRepo: InMemoryFormRepository;
  let partRepo: InMemoryParticipationRepository;
  let rewards: jest.Mocked<AttemptRewardQueryPort>;
  let rateLimiter: { assertBurstAllowed: jest.Mock };
  let logger: { warn: jest.Mock };
  let service: SurveyRunnerReadService;

  beforeEach(async () => {
    clock = new Date('2026-10-01T08:00:00.000Z');
    formRepo = new InMemoryFormRepository();
    partRepo = new InMemoryParticipationRepository();
    partRepo.formStatusLookup = (formId) => formRepo.peekForm(formId)?.status;
    rewards = fakeRewards();
    rateLimiter = {
      assertBurstAllowed: jest.fn().mockResolvedValue(undefined),
    };
    logger = { warn: jest.fn() };
    service = new SurveyRunnerReadService({
      formRepository: formRepo,
      participationRepository: partRepo,
      rewards,
      rateLimiter,
      logger,
      now: () => clock,
    });

    await formRepo.create(
      makeForm(ids.internalForm, 'INTERNAL'),
      makeVersion(ids.internalV1, ids.internalForm, 1, definition(['q1'])),
    );
    await formRepo.create(
      makeForm(ids.externalForm, 'EXTERNAL'),
      makeVersion(ids.externalV1, ids.externalForm, 1, definition([]), {
        externalUrl: GOOGLE_V1,
      }),
    );
  });

  /** Inserts an attempt (and, for INTERNAL, its Response) without the start checks. */
  async function seedAttempt(
    options: Partial<{
      formId: string;
      versionId: string;
      type: 'INTERNAL' | 'EXTERNAL';
      respondentId: string | null;
      startedAt: Date;
    }> = {},
  ) {
    const type = options.type ?? 'INTERNAL';
    const respondentId =
      options.respondentId === undefined
        ? ids.respondent
        : options.respondentId;
    return partRepo.createAttemptWithResponse({
      attemptId: randomUUID(),
      formId:
        options.formId ??
        (type === 'INTERNAL' ? ids.internalForm : ids.externalForm),
      formVersionId:
        options.versionId ??
        (type === 'INTERNAL' ? ids.internalV1 : ids.externalV1),
      respondentId,
      isGuest: respondentId === null,
      formType: type,
      ipAddress: '127.0.0.1',
      startedAt: options.startedAt ?? new Date(clock.getTime() - MINUTE),
    });
  }

  /** Overwrites an attempt's state (status, counters, closed reason). */
  function setAttempt(
    attempt: SurveyAttemptEntity,
    changes: Partial<{
      status: AttemptStatus;
      submittedAt: Date | null;
      failedCount: number;
      closedReason: 'EXPIRED' | 'CANCELLED' | null;
      closedAt: Date | null;
    }>,
  ): SurveyAttemptEntity {
    const next = new SurveyAttemptEntity(
      attempt.id,
      attempt.surveyId,
      attempt.formVersionId,
      attempt.respondentId,
      changes.status ?? attempt.status,
      attempt.isGuest,
      attempt.startedAt,
      changes.submittedAt === undefined
        ? attempt.submittedAt
        : changes.submittedAt,
      attempt.clientContext,
      attempt.createdAt,
      attempt.updatedAt,
      {
        ...EMPTY_CODE_VERIFICATION_STATE,
        failedCount:
          changes.failedCount ?? attempt.codeVerification.failedCount,
      },
      changes.closedReason === undefined
        ? attempt.closedReason
        : changes.closedReason,
      changes.closedAt === undefined ? attempt.closedAt : changes.closedAt,
    );
    partRepo.attempts.set(next.id, next);
    return next;
  }

  describe('getSurveySummary (API-01)', () => {
    it('returns only the public facts of a PUBLISHED survey', async () => {
      const findById = jest.spyOn(formRepo, 'findById');
      const summary = await service.getSurveySummary(ids.internalForm);

      // Review LOW-8: the slim read, never every version's full schemaJson.
      expect(findById).not.toHaveBeenCalled();

      expect(summary).toEqual({
        id: ids.internalForm,
        title: 'INTERNAL survey',
        description: 'Mô tả khảo sát',
        type: 'INTERNAL',
        status: 'PUBLISHED',
        rewardPerResponse: 12,
        estimatedEffortSeconds: 300,
        expectedCompletions: 3,
        completedCompletions: 0,
        remainingSlots: 3,
      });
      expect(surveySummarySchema.safeParse(summary).success).toBe(true);
      const json = JSON.stringify(summary);
      for (const secret of [
        'targetingJson',
        'completionCode',
        'publisherId',
        'externalUrl',
        ids.publisher,
      ]) {
        expect(json).not.toContain(secret);
      }
    });

    it('counts completions and active reservations, not expired ones', async () => {
      const completed = await seedAttempt({ type: 'EXTERNAL' });
      setAttempt(completed.attempt, {
        status: 'COMPLETED',
        submittedAt: clock,
      });
      await seedAttempt({ type: 'EXTERNAL', respondentId: ids.other });
      await seedAttempt({
        type: 'EXTERNAL',
        respondentId: null,
        startedAt: new Date(clock.getTime() - RESERVATION_EXPIRY_MS - MINUTE),
      });

      const summary = await service.getSurveySummary(ids.externalForm);

      expect(summary.completedCompletions).toBe(1);
      expect(summary.remainingSlots).toBe(1);
    });

    it('never reports negative remaining slots', async () => {
      for (const respondentId of [ids.respondent, ids.other, null, null]) {
        await seedAttempt({ type: 'EXTERNAL', respondentId });
      }
      await expect(
        service.getSurveySummary(ids.externalForm),
      ).resolves.toMatchObject({ remainingSlots: 0 });
    });

    it.each(['DRAFT', 'ESCROW_LOCKED', 'MODERATION_QUEUE', 'CLOSED'] as const)(
      'answers 404 SURVEY_NOT_FOUND for a %s survey, like an unknown one',
      async (status) => {
        const formId = randomUUID();
        await formRepo.create(
          makeForm(formId, 'INTERNAL', { status }),
          makeVersion(randomUUID(), formId, 1, definition(['q1'])),
        );

        const hidden = await service
          .getSurveySummary(formId)
          .catch((error: unknown) => error);
        const unknown = await service
          .getSurveySummary(randomUUID())
          .catch((error: unknown) => error);

        expect(hidden).toBeInstanceOf(SurveyNotFoundException);
        expect(unknown).toBeInstanceOf(SurveyNotFoundException);
        expect((hidden as Error).message).toBe((unknown as Error).message);
      },
    );

    it('answers 404 for a PUBLISHED survey without a published version', async () => {
      const formId = randomUUID();
      await formRepo.create(
        makeForm(formId, 'INTERNAL'),
        makeVersion(randomUUID(), formId, 1, definition(['q1']), {
          isPublished: false,
        }),
      );
      await expect(service.getSurveySummary(formId)).rejects.toBeInstanceOf(
        SurveyNotFoundException,
      );
    });

    it('answers 404 for a PUBLISHED survey whose deadline has passed (before the close job runs)', async () => {
      const formId = randomUUID();
      await formRepo.create(
        makeForm(formId, 'INTERNAL', {
          deadlineAt: new Date(clock.getTime() - MINUTE),
        }),
        makeVersion(randomUUID(), formId, 1, definition(['q1'])),
      );
      await expect(service.getSurveySummary(formId)).rejects.toBeInstanceOf(
        SurveyNotFoundException,
      );
    });

    it('BE-12 effort: duration minutes, then the newest published metadata, then 60 s', async () => {
      const minutesForm = randomUUID();
      await formRepo.create(
        makeForm(minutesForm, 'INTERNAL', { estimatedDurationMinutes: 8 }),
        makeVersion(randomUUID(), minutesForm, 1, definition(['q1'])),
      );
      await expect(
        service.getSurveySummary(minutesForm),
      ).resolves.toMatchObject({ estimatedEffortSeconds: 480 });

      const newestPublished = randomUUID();
      await formRepo.create(
        makeForm(newestPublished, 'INTERNAL'),
        makeVersion(randomUUID(), newestPublished, 1, {
          ...definition(['q1']),
          metadata: { expectedEffortSeconds: 120, minTimeBarrierSeconds: 15 },
        }),
      );
      await formRepo.update(
        makeForm(newestPublished, 'INTERNAL'),
        makeVersion(
          randomUUID(),
          newestPublished,
          2,
          {
            ...definition(['q1']),
            metadata: {
              expectedEffortSeconds: 900,
              minTimeBarrierSeconds: 15,
            },
          },
          { isPublished: false },
        ),
      );
      await expect(
        service.getSurveySummary(newestPublished),
      ).resolves.toMatchObject({ estimatedEffortSeconds: 120 });

      const noMetadata = randomUUID();
      await formRepo.create(
        makeForm(noMetadata, 'INTERNAL'),
        makeVersion(randomUUID(), noMetadata, 1, { blocks: [] }),
      );
      await expect(service.getSurveySummary(noMetadata)).resolves.toMatchObject(
        { estimatedEffortSeconds: 60 },
      );
    });
  });

  describe('getAttemptDetails (API-02 + API-05)', () => {
    it("returns the owner's Internal attempt with its pinned form", async () => {
      const { attempt, response } = await seedAttempt();

      const details = await service.getAttemptDetails(
        attempt.id,
        ids.respondent,
      );

      expect(surveyAttemptDetailsSchema.safeParse(details).success).toBe(true);
      expect(details).toMatchObject({
        attemptId: attempt.id,
        responseId: response!.id,
        formId: ids.internalForm,
        formVersionId: ids.internalV1,
        versionNumber: 1,
        type: 'INTERNAL',
        status: 'IN_PROGRESS',
        closedReason: null,
        closedAt: null,
        startedAt: attempt.startedAt.toISOString(),
        expiresAt: new Date(
          attempt.startedAt.getTime() + RESERVATION_EXPIRY_MS,
        ).toISOString(),
        submittedAt: null,
        wrongCodeCount: 0,
        accountWrongCodeCount: 0,
        survey: {
          title: 'INTERNAL survey',
          status: 'PUBLISHED',
          rewardPerResponse: 12,
          estimatedEffortSeconds: 300,
          externalUrl: null,
        },
      });
      expect(details.form).toMatchObject({
        formVersionId: ids.internalV1,
        versionNumber: 1,
        title: 'Thói quen tự học (bản đã ghim)',
        description: 'Mô tả của phiên bản',
        blocks: [expect.objectContaining({ id: 'q1' })],
        settings: expect.objectContaining({ requireAuth: true }),
        publishedAt: '2026-09-30T08:00:00.000Z',
      });
      expect(JSON.stringify(details)).not.toContain('clientContext');
    });

    it('strips block integrity from the pinned form (MEDIUM-1)', async () => {
      const formId = randomUUID();
      const versionId = randomUUID();
      const withChecks = definition(['q1']);
      withChecks.blocks = [
        { ...withChecks.blocks[0], integrity: { semanticCategory: 'GENERAL' } },
        {
          id: 'q2',
          order: 1,
          type: 'rating',
          title: 'Hãy chọn 4 sao',
          required: true,
          maxRating: 5,
          ratingShape: 'STAR',
          integrity: {
            attentionCheck: {
              isAttentionCheck: true,
              expectedValue: 4,
              failAction: 'DISQUALIFY',
            },
            consistencyPair: { pairedBlockId: 'q1', rule: 'EQUIVALENT' },
            semanticCategory: 'ATTENTION_CHECK',
          },
        },
      ];
      await formRepo.create(
        makeForm(formId, 'INTERNAL'),
        makeVersion(versionId, formId, 1, withChecks),
      );
      const { attempt } = await seedAttempt({ formId, versionId });

      const details = await service.getAttemptDetails(
        attempt.id,
        ids.respondent,
      );

      expect(surveyAttemptDetailsSchema.safeParse(details).success).toBe(true);
      expect(details.form?.blocks.map((block) => block.id)).toEqual([
        'q1',
        'q2',
      ]);
      const json = JSON.stringify(details);
      expect(json).not.toContain('integrity');
      expect(json).not.toContain('expectedValue');
      expect(json).not.toContain('isAttentionCheck');
      expect(json).not.toContain('consistencyPair');
      expect(json).not.toContain('ATTENTION_CHECK');
    });

    it('announces the same time barrier as the start response', async () => {
      const demographics = new InMemoryDemographicProfileRepository();
      await demographics.upsert(ids.respondent, {
        age: 22,
        gender: 'MALE',
        location: 'Hanoi',
        occupation: 'Student',
        fieldOfStudy: 'Computer Science',
        householdIncome: 'Under 5M VND',
        specificInterests: ['Technology'],
      });
      const participation = new ParticipationService(
        formRepo,
        demographics,
        partRepo,
      );

      const started = await participation.startAttempt(
        ids.internalForm,
        ids.respondent,
        {},
        '127.0.0.1',
      );
      const details = await service.getAttemptDetails(
        started.attemptId,
        ids.respondent,
      );

      expect(details.timeBarrier).toEqual(started.timeBarrier);
      expect(details.responseId).toBe(started.responseId);
      expect(details.expiresAt).toBe(started.expiresAt);
    });

    it('keeps serving the pinned version after a newer one is published (AD-19)', async () => {
      const { attempt } = await seedAttempt();
      const before = await service.getAttemptDetails(
        attempt.id,
        ids.respondent,
      );

      await formRepo.createVersion(ids.internalForm, ids.internalV2, clock, {
        isPublished: true,
        expectedStatus: 'PUBLISHED',
      });
      const current = await formRepo.findById(ids.internalForm);
      await formRepo.update(
        current!.form,
        current!.currentVersion.copyWith({
          schemaJson: definition(['n1', 'n2', 'n3', 'n4', 'n5'], 25),
        }),
      );

      const after = await service.getAttemptDetails(attempt.id, ids.respondent);
      expect(after.versionNumber).toBe(1);
      expect(after.form?.blocks.map((block) => block.id)).toEqual(['q1']);
      expect(after.timeBarrier).toEqual(before.timeBarrier);
    });

    it('reports a survey that left PUBLISHED through survey.status', async () => {
      const { attempt } = await seedAttempt();
      await formRepo.createVersion(ids.internalForm, ids.internalV2, clock);

      const details = await service.getAttemptDetails(
        attempt.id,
        ids.respondent,
      );
      expect(details.survey.status).toBe('DRAFT');
      expect(details.form?.formVersionId).toBe(ids.internalV1);
    });

    it('External: no form, the pinned Google Form link and the reset-aware account count', async () => {
      await formRepo.createVersion(ids.externalForm, ids.externalV2, clock, {
        isPublished: true,
        expectedStatus: 'PUBLISHED',
      });
      const current = await formRepo.findById(ids.externalForm);
      await formRepo.update(
        current!.form,
        current!.currentVersion.copyWith({ externalUrl: GOOGLE_V2 }),
      );
      const locked = await seedAttempt({
        type: 'EXTERNAL',
        startedAt: new Date(clock.getTime() - 2 * HOUR),
      });
      setAttempt(locked.attempt, { status: 'LOCKED', failedCount: 3 });
      const { attempt } = await seedAttempt({ type: 'EXTERNAL' });
      setAttempt(attempt, { failedCount: 2 });

      const details = await service.getAttemptDetails(
        attempt.id,
        ids.respondent,
      );
      expect(surveyAttemptDetailsSchema.safeParse(details).success).toBe(true);
      expect(details).toMatchObject({
        responseId: null,
        type: 'EXTERNAL',
        form: null,
        wrongCodeCount: 2,
        accountWrongCodeCount: 5,
        survey: { externalUrl: GOOGLE_V1 },
        timeBarrier: { requiredSeconds: 20, questionCount: null },
      });

      // Decision E5-D1: an Admin reset forgives the counted wrong codes.
      await partRepo.resetCompletionCodeFailures({
        respondentId: ids.respondent,
        formVersionId: ids.externalV1,
        resetById: ids.publisher,
        reason: 'Đã xác minh',
        policyVersion: 'completion-code-policy-v1',
      });
      await expect(
        service.getAttemptDetails(attempt.id, ids.respondent),
      ).resolves.toMatchObject({ accountWrongCodeCount: 0 });
    });

    it('returns an expired reservation as persisted, without writing', async () => {
      const { attempt } = await seedAttempt({
        startedAt: new Date(clock.getTime() - RESERVATION_EXPIRY_MS - MINUTE),
      });
      const writes = [
        jest.spyOn(partRepo, 'abandonExpiredAttempts'),
        jest.spyOn(partRepo, 'reserveAttempt'),
        jest.spyOn(partRepo, 'cancelAttempt'),
        jest.spyOn(partRepo, 'submitInternalResponseTransaction'),
      ];

      const details = await service.getAttemptDetails(
        attempt.id,
        ids.respondent,
      );

      expect(details.status).toBe('IN_PROGRESS');
      expect(Date.parse(details.expiresAt)).toBeLessThan(clock.getTime());
      expect(partRepo.attempts.get(attempt.id)).toBe(attempt);
      for (const write of writes) {
        expect(write).not.toHaveBeenCalled();
      }
    });

    it('answers one 404 for another user, a guest attempt and an unknown id', async () => {
      const { attempt } = await seedAttempt();
      const guest = await seedAttempt({ respondentId: null });

      const errors = await Promise.all([
        service.getAttemptDetails(attempt.id, ids.other).catch((e) => e),
        service
          .getAttemptDetails(guest.attempt.id, ids.respondent)
          .catch((e) => e),
        service.getAttemptDetails(randomUUID(), ids.respondent).catch((e) => e),
      ]);

      for (const error of errors) {
        expect(error).toBeInstanceOf(AttemptNotFoundException);
        expect(error.message).toBe(errors[0].message);
      }
    });

    it('answers 404 with a warning when the pinned version is unusable', async () => {
      const missingVersion = await seedAttempt({ versionId: randomUUID() });
      await expect(
        service.getAttemptDetails(missingVersion.attempt.id, ids.respondent),
      ).rejects.toBeInstanceOf(AttemptNotFoundException);

      const formId = randomUUID();
      const versionId = randomUUID();
      await formRepo.create(
        makeForm(formId, 'INTERNAL'),
        makeVersion(versionId, formId, 1, { blocks: 'corrupted' }),
      );
      const corrupted = await seedAttempt({ formId, versionId });
      await expect(
        service.getAttemptDetails(corrupted.attempt.id, ids.respondent),
      ).rejects.toBeInstanceOf(AttemptNotFoundException);

      expect(logger.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAttemptOutcome (API-04)', () => {
    const journalId = '40000000-0000-4000-8000-000000000001';
    const creditedAt = '2026-10-01T07:00:00.000Z';

    async function completedAttempt(type: 'INTERNAL' | 'EXTERNAL') {
      const seeded = await seedAttempt({ type });
      const attempt = setAttempt(seeded.attempt, {
        status: 'COMPLETED',
        submittedAt: new Date(creditedAt),
      });
      return { attempt, response: seeded.response };
    }

    function settlement(
      status: 'SETTLED' | 'HELD_IN_INTEGRITY' | 'PENDING',
      amount = 12,
    ) {
      return {
        status,
        journalId,
        amount,
        targetAccountClass: null,
        settledAt: creditedAt,
      };
    }

    async function outcomeOf(attemptId: string) {
      const outcome = await service.getAttemptOutcome(
        attemptId,
        ids.respondent,
      );
      const parsed = attemptOutcomeSchema.safeParse(outcome);
      expect(parsed.success ? null : parsed.error.issues).toBeNull();
      return outcome;
    }

    it('reads NOT_COMPLETED without any ledger read', async () => {
      const { attempt } = await seedAttempt();

      await expect(outcomeOf(attempt.id)).resolves.toMatchObject({
        attemptStatus: 'IN_PROGRESS',
        submittedAt: null,
        reward: { state: 'NOT_COMPLETED', amount: 0, journalId: null },
        accountActivated: false,
      });
      for (const query of Object.values(rewards)) {
        expect(query).not.toHaveBeenCalled();
      }
    });

    it('Internal: AVAILABLE from the instant-credit journal, never the form price', async () => {
      const { attempt, response } = await completedAttempt('INTERNAL');
      rewards.findInternalSettlement.mockResolvedValue(settlement('SETTLED'));
      await formRepo.update(
        makeForm(ids.internalForm, 'INTERNAL', { rewardPerResponse: 99 }),
      );

      await expect(outcomeOf(attempt.id)).resolves.toMatchObject({
        attemptStatus: 'COMPLETED',
        submittedAt: creditedAt,
        reward: {
          state: 'AVAILABLE',
          amount: 12,
          targetAccountClass: 'USER_AVAILABLE',
          journalId,
          creditedAt,
          releasesAt: null,
        },
      });
      expect(rewards.findInternalSettlement).toHaveBeenCalledWith(response!.id);
    });

    it('Internal: HELD_IN_INTEGRITY from an ENFORCED integrity hold', async () => {
      const { attempt } = await completedAttempt('INTERNAL');
      rewards.findInternalSettlement.mockResolvedValue(
        settlement('HELD_IN_INTEGRITY'),
      );

      await expect(outcomeOf(attempt.id)).resolves.toMatchObject({
        reward: {
          state: 'HELD_IN_INTEGRITY',
          targetAccountClass: 'INTEGRITY_HOLD',
        },
      });
    });

    it('Internal without a journal: AWAITING_SETTLEMENT when a reward is owed, else NO_REWARD', async () => {
      const owed = await completedAttempt('INTERNAL');
      partRepo.outboxEvents.push({
        id: randomUUID(),
        eventType: 'InternalRewardRequested',
        idempotencyKey: `internal-reward:${owed.response!.id}`,
        payload: {
          publisherId: ids.publisher,
          respondentId: ids.respondent,
          rewardAmount: 12,
          policyMode: 'SHADOW',
        },
      });
      await expect(outcomeOf(owed.attempt.id)).resolves.toMatchObject({
        reward: { state: 'AWAITING_SETTLEMENT', amount: 0, journalId: null },
      });

      const free = await completedAttempt('INTERNAL');
      partRepo.outboxEvents.push({
        id: randomUUID(),
        eventType: 'InternalRewardRequested',
        idempotencyKey: `internal-reward:${free.response!.id}`,
        payload: {
          publisherId: ids.publisher,
          respondentId: ids.respondent,
          rewardAmount: 0,
          policyMode: 'SHADOW',
        },
      });
      await expect(outcomeOf(free.attempt.id)).resolves.toMatchObject({
        reward: { state: 'NO_REWARD' },
      });
    });

    it.each([
      ['RELEASED', 'AVAILABLE', 'USER_AVAILABLE'],
      ['HELD', 'HELD_IN_DISPUTE', 'PENDING'],
      ['REVERSED', 'REVERSED', null],
      ['REFUNDED_TO_PUBLISHER', 'REVERSED', null],
    ] as const)(
      'External: settlement state %s reads %s',
      async (state, expected, targetAccountClass) => {
        const { attempt } = await completedAttempt('EXTERNAL');
        rewards.findExternalSettlement.mockResolvedValue(settlement('PENDING'));
        rewards.getExternalSettlementState.mockResolvedValue(state);

        await expect(outcomeOf(attempt.id)).resolves.toMatchObject({
          reward: {
            state: expected,
            amount: 12,
            targetAccountClass,
            journalId,
            creditedAt,
            releasesAt: null,
          },
        });
      },
    );

    it('External: PENDING until the credit is 48 h old', async () => {
      const { attempt } = await completedAttempt('EXTERNAL');
      rewards.findExternalSettlement.mockResolvedValue(settlement('PENDING'));
      rewards.getExternalSettlementState.mockResolvedValue('PENDING');

      await expect(outcomeOf(attempt.id)).resolves.toMatchObject({
        reward: {
          state: 'PENDING',
          targetAccountClass: 'PENDING',
          releasesAt: '2026-10-03T07:00:00.000Z',
        },
      });
    });

    it('External without a credit journal: NO_REWARD', async () => {
      const { attempt } = await completedAttempt('EXTERNAL');

      await expect(outcomeOf(attempt.id)).resolves.toMatchObject({
        reward: { state: 'NO_REWARD', amount: 0 },
      });
      expect(rewards.getExternalSettlementState).not.toHaveBeenCalled();
    });

    it('attributes the starter unlock only to its own logical Form and source', async () => {
      const { attempt } = await completedAttempt('INTERNAL');
      rewards.findInternalSettlement.mockResolvedValue(settlement('SETTLED'));
      const activation = (formId: string, source: 'INTERNAL' | 'EXTERNAL') => ({
        unlockedAt: new Date('2026-10-01T07:00:01.000Z'),
        amount: 100,
        activationSurvey: {
          source,
          formId,
          completedAt: creditedAt,
          confirmsAt: creditedAt,
          status: 'CONFIRMED' as const,
        },
      });

      rewards.getActivationSnapshot.mockResolvedValue(
        activation(ids.internalForm, 'INTERNAL'),
      );
      await expect(outcomeOf(attempt.id)).resolves.toMatchObject({
        accountActivated: true,
        starterUnlock: {
          activatedByThisAttempt: true,
          amount: 100,
          activatedAt: '2026-10-01T07:00:01.000Z',
        },
      });

      for (const other of [
        activation(ids.externalForm, 'INTERNAL'),
        activation(ids.internalForm, 'EXTERNAL'),
        { unlockedAt: null, amount: null, activationSurvey: null },
      ]) {
        rewards.getActivationSnapshot.mockResolvedValue(other);
        await expect(outcomeOf(attempt.id)).resolves.toMatchObject({
          accountActivated: false,
          starterUnlock: {
            activatedByThisAttempt: false,
            amount: null,
            activatedAt: null,
          },
        });
      }
    });

    it("answers 404 for another user's attempt", async () => {
      const { attempt } = await completedAttempt('INTERNAL');
      await expect(
        service.getAttemptOutcome(attempt.id, ids.other),
      ).rejects.toBeInstanceOf(AttemptNotFoundException);
    });
  });

  describe('getAttemptOutcome on the Economy coordinators (read-only)', () => {
    let ledgerRepo: InMemoryLedgerRepository;
    let ledger: LedgerService;
    let settlementCoordinator: RewardSettlementCoordinator;
    let starterPoints: StarterPointsCoordinator;
    let dataProvider: InMemoryStarterPointsDataProvider;
    let publish: jest.Mock;
    let ledgerClock: Date;

    beforeEach(async () => {
      ledgerClock = new Date('2026-10-01T07:00:00.000Z');
      ledgerRepo = new InMemoryLedgerRepository();
      ledger = new LedgerService(ledgerRepo, { clock: () => ledgerClock });
      publish = jest.fn().mockResolvedValue(undefined);
      dataProvider = new InMemoryStarterPointsDataProvider();
      dataProvider.userRegistrationDates.set(
        ids.respondent,
        new Date('2026-09-30T00:00:00.000Z'),
      );
      dataProvider.demographicCompletions.set(ids.respondent, true);
      starterPoints = new StarterPointsCoordinator(ledger, dataProvider, {
        publish,
      });
      settlementCoordinator = new RewardSettlementCoordinator(
        ledger,
        { publish },
        starterPoints,
      );
      service = new SurveyRunnerReadService({
        formRepository: formRepo,
        participationRepository: partRepo,
        rewards: economyAttemptRewardQueries(
          settlementCoordinator,
          starterPoints,
        ),
        now: () => clock,
      });

      const issuance = await ledger.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const escrow = await ledger.getOrCreateAccount(ids.publisher, 'ESCROW');
      await ledger.postJournal({
        idempotencyKey: 'seed-publisher-escrow',
        entries: [
          { accountId: issuance.id, amount: -500 },
          { accountId: escrow.id, amount: 500 },
        ],
      });
    });

    async function completed(type: 'INTERNAL' | 'EXTERNAL') {
      const seeded = await seedAttempt({ type });
      const attempt = setAttempt(seeded.attempt, {
        status: 'COMPLETED',
        submittedAt: ledgerClock,
      });
      return { attempt, response: seeded.response };
    }

    /** Spies on every Economy command the outcome must never reach. */
    function commandSpies() {
      return [
        jest.spyOn(settlementCoordinator, 'settleInternalReward'),
        jest.spyOn(settlementCoordinator, 'settleExternalReward'),
        jest.spyOn(settlementCoordinator, 'releasePendingReward'),
        jest.spyOn(starterPoints, 'tryUnlockStarterPoints'),
        jest.spyOn(starterPoints, 'checkAndUnlockStarterPoints'),
        jest.spyOn(starterPoints, 'ensureStarterGrant'),
        jest.spyOn(ledgerRepo, 'postJournalTransaction'),
      ];
    }

    it('reads posted journals without settling, releasing, unlocking or notifying', async () => {
      const internal = await completed('INTERNAL');
      const external = await completed('EXTERNAL');
      await settlementCoordinator.settleInternalReward({
        responseId: internal.response!.id,
        publisherId: ids.publisher,
        respondentId: ids.respondent,
        rewardPerResponse: 12,
      });
      await settlementCoordinator.settleExternalReward({
        attemptId: external.attempt.id,
        publisherId: ids.publisher,
        respondentId: ids.respondent,
        rewardPerResponse: 18,
      });
      publish.mockClear();
      const spies = commandSpies();

      for (let read = 0; read < 3; read++) {
        await expect(
          service.getAttemptOutcome(internal.attempt.id, ids.respondent),
        ).resolves.toMatchObject({
          reward: { state: 'AVAILABLE', amount: 12 },
        });
        await expect(
          service.getAttemptOutcome(external.attempt.id, ids.respondent),
        ).resolves.toMatchObject({
          reward: {
            state: 'PENDING',
            amount: 18,
            creditedAt: '2026-10-01T07:00:00.000Z',
            releasesAt: '2026-10-03T07:00:00.000Z',
          },
        });
      }

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(publish).not.toHaveBeenCalled();
    });

    it('follows a dispute hold and a reversal from the ledger', async () => {
      const disputed = await completed('EXTERNAL');
      await settlementCoordinator.settleExternalReward({
        attemptId: disputed.attempt.id,
        publisherId: ids.publisher,
        respondentId: ids.respondent,
        rewardPerResponse: 18,
      });
      await ledger.placeDisputeHold({
        caseId: randomUUID(),
        attemptId: disputed.attempt.id,
        respondentId: ids.respondent,
        amount: 18,
      });
      await expect(
        service.getAttemptOutcome(disputed.attempt.id, ids.respondent),
      ).resolves.toMatchObject({
        reward: {
          state: 'HELD_IN_DISPUTE',
          amount: 18,
          targetAccountClass: 'PENDING',
        },
      });

      const reversed = await completed('EXTERNAL');
      const credit = await settlementCoordinator.settleExternalReward({
        attemptId: reversed.attempt.id,
        publisherId: ids.publisher,
        respondentId: ids.respondent,
        rewardPerResponse: 18,
      });
      await ledger.reverseJournal({ targetJournalId: credit.journalId! });
      await expect(
        service.getAttemptOutcome(reversed.attempt.id, ids.respondent),
      ).resolves.toMatchObject({
        reward: {
          state: 'REVERSED',
          amount: 18,
          targetAccountClass: null,
          journalId: credit.journalId,
        },
      });
    });

    it('reads AVAILABLE after the 48 h release and attributes the starter unlock', async () => {
      // The activation rule runs on the wall clock: a completion 3 days ago
      // of an account registered 10 days ago is confirmed and in-window.
      const DAY = 24 * HOUR;
      dataProvider.userRegistrationDates.set(
        ids.respondent,
        new Date(Date.now() - 10 * DAY),
      );
      const external = await completed('EXTERNAL');
      await starterPoints.grantStarterPoints(ids.respondent);
      await settlementCoordinator.settleExternalReward({
        attemptId: external.attempt.id,
        publisherId: ids.publisher,
        respondentId: ids.respondent,
        rewardPerResponse: 18,
      });
      dataProvider.recordCompletion(ids.respondent, {
        source: 'EXTERNAL',
        formId: ids.externalForm,
        attemptId: external.attempt.id,
        completedAt: new Date(Date.now() - 3 * DAY),
        rewardPerResponse: 18,
      });

      ledgerClock = new Date(ledgerClock.getTime() + 49 * HOUR);
      await settlementCoordinator.releasePendingReward({
        attemptId: external.attempt.id,
      });
      const spies = commandSpies();

      const outcome = await service.getAttemptOutcome(
        external.attempt.id,
        ids.respondent,
      );
      expect(outcome).toMatchObject({
        reward: { state: 'AVAILABLE', targetAccountClass: 'USER_AVAILABLE' },
        accountActivated: true,
        starterUnlock: { activatedByThisAttempt: true, amount: 100 },
      });
      expect(attemptOutcomeSchema.safeParse(outcome).success).toBe(true);
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });

  describe('cancelAttempt (API-03)', () => {
    it('abandons the attempt, releases its reservation and replays the original closedAt', async () => {
      const { attempt } = await seedAttempt({ type: 'EXTERNAL' });
      const cutoff = new Date(clock.getTime() - RESERVATION_EXPIRY_MS);
      await expect(
        partRepo.getQuotaStatus(ids.externalForm, cutoff),
      ).resolves.toMatchObject({ activeReservationCount: 1 });

      const first = await service.cancelAttempt(attempt.id, ids.respondent);
      expect(first).toEqual({
        attemptId: attempt.id,
        status: 'ABANDONED',
        closedReason: 'CANCELLED',
        closedAt: clock.toISOString(),
      });
      expect(cancelAttemptResponseSchema.safeParse(first).success).toBe(true);
      await expect(
        partRepo.getQuotaStatus(ids.externalForm, cutoff),
      ).resolves.toMatchObject({ activeReservationCount: 0 });

      clock = new Date(clock.getTime() + 5 * MINUTE);
      await expect(
        service.cancelAttempt(attempt.id, ids.respondent),
      ).resolves.toEqual(first);
      expect(rateLimiter.assertBurstAllowed).toHaveBeenCalledWith(
        ids.respondent,
        'ATTEMPT_CANCEL',
        { attemptId: attempt.id },
      );
    });

    it('keeps the Internal Response IN_PROGRESS (the attempt is authoritative)', async () => {
      const { attempt, response } = await seedAttempt();
      await service.cancelAttempt(attempt.id, ids.respondent);
      expect(partRepo.responses.get(response!.id)?.status).toBe('IN_PROGRESS');
    });

    it.each([
      ['COMPLETED', null, false, { status: 'COMPLETED', closedReason: null }],
      ['LOCKED', null, false, { status: 'LOCKED', closedReason: null }],
      [
        'ABANDONED',
        'EXPIRED',
        false,
        { status: 'ABANDONED', closedReason: 'EXPIRED' },
      ],
      ['ABANDONED', null, false, { status: 'ABANDONED', closedReason: null }],
      [
        'IN_PROGRESS',
        null,
        true,
        { status: 'IN_PROGRESS', closedReason: 'EXPIRED' },
      ],
    ] as const)(
      'refuses a %s attempt (closed reason %s, expired %s) with 409 details',
      async (status, closedReason, expired, details) => {
        const seeded = await seedAttempt({
          startedAt: expired
            ? new Date(clock.getTime() - RESERVATION_EXPIRY_MS - MINUTE)
            : new Date(clock.getTime() - MINUTE),
        });
        setAttempt(seeded.attempt, { status, closedReason });

        const error = await service
          .cancelAttempt(seeded.attempt.id, ids.respondent)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AttemptNotInProgressException);
        expect((error as AttemptNotInProgressException).details).toEqual(
          details,
        );
        expect(partRepo.attempts.get(seeded.attempt.id)?.status).toBe(status);
      },
    );

    it('answers 404 for an unknown id or another user without spending the burst budget', async () => {
      const { attempt } = await seedAttempt();
      await expect(
        service.cancelAttempt(randomUUID(), ids.respondent),
      ).rejects.toBeInstanceOf(AttemptNotFoundException);
      await expect(
        service.cancelAttempt(attempt.id, ids.other),
      ).rejects.toBeInstanceOf(AttemptNotFoundException);
      expect(rateLimiter.assertBurstAllowed).not.toHaveBeenCalled();
      expect(partRepo.attempts.get(attempt.id)?.status).toBe('IN_PROGRESS');
    });

    it("checks the cancel burst bucket before closing the owner's attempt", async () => {
      const { attempt } = await seedAttempt();
      rateLimiter.assertBurstAllowed.mockRejectedValueOnce(
        new Error('rate limited'),
      );
      await expect(
        service.cancelAttempt(attempt.id, ids.respondent),
      ).rejects.toThrow('rate limited');
      expect(rateLimiter.assertBurstAllowed).toHaveBeenCalledWith(
        ids.respondent,
        'ATTEMPT_CANCEL',
        { attemptId: attempt.id },
      );
      expect(partRepo.attempts.get(attempt.id)?.status).toBe('IN_PROGRESS');
    });
  });
});
