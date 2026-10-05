import {
  ATTEMPT_NOT_FOUND_CODE,
  ATTEMPT_NOT_IN_PROGRESS_CODE,
  DEFAULT_ESTIMATED_EFFORT_SECONDS,
  SURVEY_NOT_FOUND_CODE,
  attemptCloseReasonSchema,
  attemptNotInProgressDetailsSchema,
  attemptOutcomeSchema,
  attemptPinnedFormSchema,
  attemptRewardStateSchema,
  attemptStatusSchema,
  cancelAttemptRequestSchema,
  cancelAttemptResponseSchema,
  resolveEstimatedEffortSeconds,
  surveyAttemptDetailsSchema,
  surveySummarySchema,
} from './survey-runner.schema';
import * as rootExports from '../index';

const ids = {
  survey: '11111111-1111-4111-8111-111111111111',
  attempt: '22222222-2222-4222-8222-222222222222',
  response: '33333333-3333-4333-8333-333333333333',
  version: '44444444-4444-4444-8444-444444444444',
  journal: '55555555-5555-4555-8555-555555555555',
};

const summary = {
  id: ids.survey,
  title: 'Thói quen tự học',
  description: null,
  type: 'INTERNAL' as const,
  status: 'PUBLISHED' as const,
  rewardPerResponse: 12,
  estimatedEffortSeconds: 300,
  expectedCompletions: 100,
  completedCompletions: 62,
  remainingSlots: 37,
};

const pinnedForm = {
  formVersionId: ids.version,
  versionNumber: 1,
  title: 'Thói quen tự học',
  description: null,
  blocks: [
    {
      id: 'q1',
      order: 0,
      type: 'text',
      title: 'Bạn học mấy giờ mỗi ngày?',
      required: true,
    },
  ],
  settings: {
    shuffleBlocks: false,
    progressBar: true,
    requireAuth: true,
    allowPublicAccess: false,
    submitButtonText: 'Nộp bài',
  },
  metadata: { expectedEffortSeconds: 300, minTimeBarrierSeconds: 30 },
  publishedAt: '2026-09-30T08:00:00.000Z',
};

const attempt = {
  attemptId: ids.attempt,
  responseId: ids.response,
  formId: ids.survey,
  formVersionId: ids.version,
  versionNumber: 1,
  type: 'INTERNAL' as const,
  status: 'IN_PROGRESS' as const,
  closedReason: null,
  closedAt: null,
  startedAt: '2026-10-01T08:00:00.000Z',
  expiresAt: '2026-10-01T08:30:00.000Z',
  submittedAt: null,
  wrongCodeCount: 0,
  accountWrongCodeCount: 0,
  timeBarrier: {
    requiredSeconds: 30,
    questionCount: 1,
    secondsPerQuestion: 2,
    earliestSubmitAt: '2026-10-01T08:00:30.000Z',
    policyVersion: 'time-barrier-v1',
  },
  survey: {
    title: 'Thói quen tự học',
    status: 'PUBLISHED' as const,
    rewardPerResponse: 12,
    estimatedEffortSeconds: 300,
    externalUrl: null,
  },
  form: pinnedForm,
};

const noJournal = {
  amount: 0,
  targetAccountClass: null,
  journalId: null,
  creditedAt: null,
  releasesAt: null,
};

const notActivated = {
  activatedByThisAttempt: false,
  amount: null,
  activatedAt: null,
};

const outcome = {
  attemptId: ids.attempt,
  attemptStatus: 'COMPLETED' as const,
  submittedAt: '2026-10-01T08:10:00.000Z',
  reward: {
    state: 'AVAILABLE' as const,
    amount: 12,
    targetAccountClass: 'USER_AVAILABLE' as const,
    journalId: ids.journal,
    creditedAt: '2026-10-01T08:10:01.000Z',
    releasesAt: null,
  },
  accountActivated: false,
  starterUnlock: notActivated,
};

describe('Story IR.2a: survey runner contracts', () => {
  it('exposes stable codes and the backend enums', () => {
    expect(SURVEY_NOT_FOUND_CODE).toBe('SURVEY_NOT_FOUND');
    expect(ATTEMPT_NOT_FOUND_CODE).toBe('ATTEMPT_NOT_FOUND');
    expect(ATTEMPT_NOT_IN_PROGRESS_CODE).toBe('ATTEMPT_NOT_IN_PROGRESS');
    // Must equal the Prisma enums AttemptStatus / AttemptCloseReason.
    expect(attemptStatusSchema.options).toEqual([
      'IN_PROGRESS',
      'COMPLETED',
      'ABANDONED',
      'LOCKED',
    ]);
    expect(attemptCloseReasonSchema.options).toEqual(['EXPIRED', 'CANCELLED']);
    expect(attemptRewardStateSchema.options).toHaveLength(8);
    expect(rootExports.surveyAttemptDetailsSchema).toBe(
      surveyAttemptDetailsSchema,
    );
    expect(rootExports.cancelAttemptResponseSchema).toBe(
      cancelAttemptResponseSchema,
    );
  });

  it('BE-12 effort: duration minutes, then metadata effort, then 60 s', () => {
    expect(
      resolveEstimatedEffortSeconds({
        estimatedDurationMinutes: 8,
        metadata: { expectedEffortSeconds: 120 },
      }),
    ).toBe(480);
    expect(
      resolveEstimatedEffortSeconds({
        estimatedDurationMinutes: 0,
        metadata: { expectedEffortSeconds: 120 },
      }),
    ).toBe(120);
    expect(
      resolveEstimatedEffortSeconds({
        estimatedDurationMinutes: null,
        metadata: null,
      }),
    ).toBe(DEFAULT_ESTIMATED_EFFORT_SECONDS);
  });

  describe('surveySummarySchema', () => {
    it('accepts the public facts', () => {
      expect(surveySummarySchema.safeParse(summary).success).toBe(true);
    });

    it.each([
      ['targetingJson', { ageRange: { min: 18, max: 25 } }],
      ['hasTargeting', true],
      ['completionCode', '123456'],
      ['publisherId', ids.version],
      ['publisherName', 'Nhóm Capstone'],
      ['externalUrl', 'https://docs.google.com/forms/d/e/x/viewform'],
    ])('rejects the private field %s', (key, value) => {
      expect(
        surveySummarySchema.safeParse({ ...summary, [key]: value }).success,
      ).toBe(false);
    });

    it('requires remainingSlots and a non-negative count', () => {
      const { remainingSlots: _omitted, ...withoutSlots } = summary;
      expect(surveySummarySchema.safeParse(withoutSlots).success).toBe(false);
      expect(
        surveySummarySchema.safeParse({ ...summary, remainingSlots: -1 })
          .success,
      ).toBe(false);
    });
  });

  describe('surveyAttemptDetailsSchema', () => {
    it('accepts an Internal attempt with its pinned form', () => {
      expect(surveyAttemptDetailsSchema.safeParse(attempt).success).toBe(true);
      expect(attemptPinnedFormSchema.safeParse(pinnedForm).success).toBe(true);
    });

    it('accepts an External attempt without a form', () => {
      const external = {
        ...attempt,
        responseId: null,
        type: 'EXTERNAL' as const,
        wrongCodeCount: 1,
        accountWrongCodeCount: 4,
        survey: {
          ...attempt.survey,
          externalUrl: 'https://docs.google.com/forms/d/e/abc/viewform',
        },
        form: null,
      };
      expect(surveyAttemptDetailsSchema.safeParse(external).success).toBe(true);
    });

    it('ties the pinned form to the Internal type', () => {
      expect(
        surveyAttemptDetailsSchema.safeParse({ ...attempt, form: null }).success,
      ).toBe(false);
      expect(
        surveyAttemptDetailsSchema.safeParse({ ...attempt, type: 'EXTERNAL' })
          .success,
      ).toBe(false);
    });

    it('accepts closed attempts and rejects legacy or unknown fields', () => {
      expect(
        surveyAttemptDetailsSchema.safeParse({
          ...attempt,
          status: 'ABANDONED',
          closedReason: 'CANCELLED',
          closedAt: '2026-10-01T08:05:00.000Z',
        }).success,
      ).toBe(true);
      for (const extra of [
        { rewardStatus: 'SETTLED' },
        { clientContext: { device: 'x' } },
        { survey: { ...attempt.survey, publisherName: 'P' } },
        { form: { ...pinnedForm, publicUrl: '/f/x' } },
      ]) {
        expect(
          surveyAttemptDetailsSchema.safeParse({ ...attempt, ...extra }).success,
        ).toBe(false);
      }
      expect(
        surveyAttemptDetailsSchema.safeParse({ ...attempt, status: 'EXPIRED' })
          .success,
      ).toBe(false);
    });

    it('rejects a pinned block that still carries integrity (MEDIUM-1)', () => {
      const withIntegrity = {
        ...pinnedForm,
        blocks: [
          {
            ...pinnedForm.blocks[0],
            integrity: {
              attentionCheck: {
                isAttentionCheck: true,
                expectedValue: '3',
                failAction: 'FLAG',
              },
            },
          },
        ],
      };
      expect(attemptPinnedFormSchema.safeParse(withIntegrity).success).toBe(
        false,
      );
      expect(
        surveyAttemptDetailsSchema.safeParse({ ...attempt, form: withIntegrity })
          .success,
      ).toBe(false);
    });

    it('requires at least one block in the pinned form', () => {
      expect(
        attemptPinnedFormSchema.safeParse({ ...pinnedForm, blocks: [] }).success,
      ).toBe(false);
    });
  });

  describe('attemptOutcomeSchema', () => {
    it('accepts an Available reward and a not-completed attempt', () => {
      expect(attemptOutcomeSchema.safeParse(outcome).success).toBe(true);
      expect(
        attemptOutcomeSchema.safeParse({
          ...outcome,
          attemptStatus: 'IN_PROGRESS',
          submittedAt: null,
          reward: { state: 'NOT_COMPLETED', ...noJournal },
        }).success,
      ).toBe(true);
    });

    it('sets releasesAt exactly while PENDING', () => {
      const pending = {
        ...outcome,
        reward: {
          ...outcome.reward,
          state: 'PENDING' as const,
          targetAccountClass: 'PENDING' as const,
          releasesAt: '2026-10-03T08:10:01.000Z',
        },
      };
      expect(attemptOutcomeSchema.safeParse(pending).success).toBe(true);
      expect(
        attemptOutcomeSchema.safeParse({
          ...pending,
          reward: { ...pending.reward, releasesAt: null },
        }).success,
      ).toBe(false);
      expect(
        attemptOutcomeSchema.safeParse({
          ...outcome,
          reward: { ...outcome.reward, releasesAt: '2026-10-03T08:10:01.000Z' },
        }).success,
      ).toBe(false);
    });

    it('ties journalId/creditedAt to the journal-backed states', () => {
      expect(
        attemptOutcomeSchema.safeParse({
          ...outcome,
          reward: { state: 'NO_REWARD', ...noJournal },
        }).success,
      ).toBe(true);
      expect(
        attemptOutcomeSchema.safeParse({
          ...outcome,
          reward: { state: 'AWAITING_SETTLEMENT', ...noJournal },
        }).success,
      ).toBe(true);
      expect(
        attemptOutcomeSchema.safeParse({
          ...outcome,
          reward: { ...outcome.reward, creditedAt: null },
        }).success,
      ).toBe(false);
      expect(
        attemptOutcomeSchema.safeParse({
          ...outcome,
          reward: { ...outcome.reward, state: 'NO_REWARD' },
        }).success,
      ).toBe(false);
      expect(
        attemptOutcomeSchema.safeParse({
          ...outcome,
          reward: { state: 'AVAILABLE', ...noJournal },
        }).success,
      ).toBe(false);
      expect(
        attemptOutcomeSchema.safeParse({
          ...outcome,
          reward: { state: 'NO_REWARD', ...noJournal, amount: 12 },
        }).success,
      ).toBe(false);
    });

    it('mirrors the starter unlock in accountActivated', () => {
      const activated = {
        ...outcome,
        accountActivated: true,
        starterUnlock: {
          activatedByThisAttempt: true,
          amount: 100,
          activatedAt: '2026-10-01T08:10:02.000Z',
        },
      };
      expect(attemptOutcomeSchema.safeParse(activated).success).toBe(true);
      expect(
        attemptOutcomeSchema.safeParse({ ...activated, accountActivated: false })
          .success,
      ).toBe(false);
      expect(
        attemptOutcomeSchema.safeParse({
          ...outcome,
          starterUnlock: { ...notActivated, amount: 100 },
        }).success,
      ).toBe(false);
    });

    it('rejects the legacy reward shape', () => {
      expect(
        attemptOutcomeSchema.safeParse({
          ...outcome,
          reward: { status: 'SETTLED', amount: 12, targetAccountClass: null },
        }).success,
      ).toBe(false);
    });
  });

  describe('cancel contracts', () => {
    it('accepts only an empty body', () => {
      expect(cancelAttemptRequestSchema.safeParse({}).success).toBe(true);
      expect(
        cancelAttemptRequestSchema.safeParse({ attemptId: ids.attempt })
          .success,
      ).toBe(false);
    });

    it('answers ABANDONED + CANCELLED with the closing time', () => {
      const body = {
        attemptId: ids.attempt,
        status: 'ABANDONED',
        closedReason: 'CANCELLED',
        closedAt: '2026-10-01T08:05:00.000Z',
      };
      expect(cancelAttemptResponseSchema.safeParse(body).success).toBe(true);
      expect(
        cancelAttemptResponseSchema.safeParse({ ...body, closedReason: 'EXPIRED' })
          .success,
      ).toBe(false);
      expect(
        cancelAttemptResponseSchema.safeParse({ attemptId: ids.attempt, status: 'ABANDONED' })
          .success,
      ).toBe(false);
    });

    it('describes a 409 ATTEMPT_NOT_IN_PROGRESS', () => {
      expect(
        attemptNotInProgressDetailsSchema.safeParse({
          status: 'IN_PROGRESS',
          closedReason: 'EXPIRED',
        }).success,
      ).toBe(true);
      expect(
        attemptNotInProgressDetailsSchema.safeParse({
          status: 'COMPLETED',
          closedReason: null,
        }).success,
      ).toBe(true);
      expect(
        attemptNotInProgressDetailsSchema.safeParse({ status: 'COMPLETED' })
          .success,
      ).toBe(false);
    });
  });
});
