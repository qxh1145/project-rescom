import {
  COMPLETION_CODE_LIMIT_REACHED_CODE,
  COMPLETION_CODE_POLICY,
  COMPLETION_CODE_POLICY_VERSION,
  completionCodeLimitDetailsSchema,
  completionCodeLimitResetRequestSchema,
  completionCodeLimitResetResultSchema,
  isCompletionCodeLimitReached,
  remainingCompletionCodeTries,
} from './completion-code-policy';
import {
  MAX_PUBLISHABLE_DURATION_MINUTES,
  MAX_PUBLISHABLE_EFFORT_SECONDS,
  MAX_PUBLISHABLE_TIME_BARRIER_SECONDS,
  RESERVATION_SUBMIT_GRACE_SECONDS,
  RESERVATION_WINDOW_SECONDS,
  SURVEY_DURATION_EXCEEDS_RESERVATION_CODE,
  checkSurveyFitsReservationWindow,
  describeReservationWindowViolation,
} from './reservation-window';
import {
  DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY,
  PARTICIPATION_RATE_LIMIT_POLICY_VERSION,
  evaluateCompletionCapacity,
  participationRateLimitDetailsSchema,
} from './bot-protection';
import { RESERVATION_EXPIRY_MINUTES } from './survey-attempt.schema';

const uuid = (n: number) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

describe('Decision E5-D1: completion-code-policy-v1 (provisional, OQ14)', () => {
  it('pins the accepted review defaults under a versioned policy', () => {
    expect(COMPLETION_CODE_POLICY_VERSION).toBe('completion-code-policy-v1');
    expect(COMPLETION_CODE_POLICY).toEqual({
      maxFailuresPerAttempt: 3,
      maxFailuresPerAccountVersion: 6,
    });
    expect(Object.isFrozen(COMPLETION_CODE_POLICY)).toBe(true);
    expect(COMPLETION_CODE_LIMIT_REACHED_CODE).toBe(
      'COMPLETION_CODE_LIMIT_REACHED',
    );
  });

  it('reports the smaller of the attempt and account+version budgets', () => {
    expect(
      remainingCompletionCodeTries({ attemptFailures: 0, accountFailures: 0 }),
    ).toBe(3);
    expect(
      remainingCompletionCodeTries({ attemptFailures: 1, accountFailures: 1 }),
    ).toBe(2);
    // Second attempt after a locked first one: 3 of the 6 already used.
    expect(
      remainingCompletionCodeTries({ attemptFailures: 1, accountFailures: 4 }),
    ).toBe(2);
    // An abandoned attempt with 2 misses + a locked one with 3 = 5 used.
    expect(
      remainingCompletionCodeTries({ attemptFailures: 0, accountFailures: 5 }),
    ).toBe(1);
    expect(
      remainingCompletionCodeTries({ attemptFailures: 3, accountFailures: 3 }),
    ).toBe(0);
    expect(
      remainingCompletionCodeTries({ attemptFailures: 0, accountFailures: 9 }),
    ).toBe(0);
    expect(
      remainingCompletionCodeTries({
        attemptFailures: Number.NaN,
        accountFailures: -4,
      }),
    ).toBe(3);
  });

  it('reaches the account+version limit at 6 counted wrong codes', () => {
    expect(isCompletionCodeLimitReached(5)).toBe(false);
    expect(isCompletionCodeLimitReached(6)).toBe(true);
    expect(isCompletionCodeLimitReached(7)).toBe(true);
  });

  it('validates the 409 details and the Admin reset contract', () => {
    expect(
      completionCodeLimitDetailsSchema.safeParse({
        formVersionId: uuid(1),
        failedVerifications: 6,
        limit: 6,
        policyVersion: COMPLETION_CODE_POLICY_VERSION,
      }).success,
    ).toBe(true);

    expect(
      completionCodeLimitResetRequestSchema.safeParse({
        respondentId: uuid(1),
        formVersionId: uuid(2),
        reason: 'Honest mistyping confirmed by support',
      }).success,
    ).toBe(true);
    // A reason is required, and nothing else may be sent.
    expect(
      completionCodeLimitResetRequestSchema.safeParse({
        respondentId: uuid(1),
        formVersionId: uuid(2),
        reason: 'ok',
      }).success,
    ).toBe(false);
    expect(
      completionCodeLimitResetRequestSchema.safeParse({
        respondentId: uuid(1),
        formVersionId: uuid(2),
        reason: 'Honest mistyping confirmed',
        failuresForgiven: 99,
      }).success,
    ).toBe(false);

    expect(
      completionCodeLimitResetResultSchema.safeParse({
        respondentId: uuid(1),
        formVersionId: uuid(2),
        failuresForgiven: 6,
        failedVerifications: 0,
        limit: 6,
        resetAt: '2026-09-26T10:00:00.000Z',
        policyVersion: COMPLETION_CODE_POLICY_VERSION,
      }).success,
    ).toBe(true);
  });
});

describe('Decision E5-D2: surveys must fit the 30-minute reservation at publish', () => {
  const blocks = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `q${index}`,
      type: 'text',
    }));

  it('derives the limits from the shared reservation window', () => {
    expect(RESERVATION_WINDOW_SECONDS).toBe(RESERVATION_EXPIRY_MINUTES * 60);
    expect(RESERVATION_SUBMIT_GRACE_SECONDS).toBe(300);
    expect(MAX_PUBLISHABLE_TIME_BARRIER_SECONDS).toBe(1500);
    expect(MAX_PUBLISHABLE_EFFORT_SECONDS).toBe(1800);
    expect(MAX_PUBLISHABLE_DURATION_MINUTES).toBe(30);
    expect(SURVEY_DURATION_EXCEEDS_RESERVATION_CODE).toBe(
      'SURVEY_DURATION_EXCEEDS_RESERVATION',
    );
  });

  it('accepts ordinary surveys and the exact boundaries', () => {
    expect(
      checkSurveyFitsReservationWindow({
        type: 'INTERNAL',
        definition: {
          blocks: blocks(5),
          metadata: { expectedEffortSeconds: 1800, minTimeBarrierSeconds: 1500 },
        },
        estimatedDurationMinutes: 30,
      }),
    ).toEqual({
      fits: true,
      reservationWindowSeconds: 1800,
      violations: [],
    });
    // 750 answerable questions x 2 s = 1500 s: still publishable.
    expect(
      checkSurveyFitsReservationWindow({
        type: 'INTERNAL',
        definition: { blocks: blocks(750), metadata: {} },
      }).fits,
    ).toBe(true);
  });

  it('uses computeInternalTimeBarrier: question count as well as the publisher minimum', () => {
    const byQuestions = checkSurveyFitsReservationWindow({
      type: 'INTERNAL',
      definition: {
        blocks: blocks(751),
        metadata: { expectedEffortSeconds: 1800, minTimeBarrierSeconds: 15 },
      },
    });
    expect(byQuestions.fits).toBe(false);
    expect(byQuestions.violations).toEqual([
      {
        rule: 'TIME_BARRIER',
        requiredSeconds: 1502,
        maxSeconds: 1500,
        questionCount: 751,
        publisherMinimumSeconds: 15,
      },
    ]);

    const byMinimum = checkSurveyFitsReservationWindow({
      type: 'INTERNAL',
      definition: {
        blocks: blocks(3),
        metadata: { expectedEffortSeconds: 1700, minTimeBarrierSeconds: 1501 },
      },
    });
    expect(byMinimum.violations).toEqual([
      expect.objectContaining({ rule: 'TIME_BARRIER', requiredSeconds: 1501 }),
    ]);
  });

  it('checks the External configured minimum, the expected effort and the estimated duration', () => {
    const result = checkSurveyFitsReservationWindow({
      type: 'EXTERNAL',
      definition: {
        blocks: [],
        metadata: { expectedEffortSeconds: 3600, minTimeBarrierSeconds: 1800 },
      },
      estimatedDurationMinutes: 45,
    });
    expect(result.fits).toBe(false);
    expect(result.violations.map((v) => v.rule)).toEqual([
      'TIME_BARRIER',
      'EXPECTED_EFFORT',
      'ESTIMATED_DURATION',
    ]);
    expect(result.violations.map(describeReservationWindowViolation)).toEqual([
      'the minimum completion time is 1800 s, above the 1500 s allowed',
      'the expected effort is 3600 s, above the 1800 s allowed',
      'the estimated duration is 45 min, above the 30 min allowed',
    ]);

    // External default barrier (15 s) and no duration: fits.
    expect(
      checkSurveyFitsReservationWindow({
        type: 'EXTERNAL',
        definition: { metadata: {} },
        estimatedDurationMinutes: null,
      }).fits,
    ).toBe(true);
  });

  it('never throws on a missing or malformed definition', () => {
    expect(
      checkSurveyFitsReservationWindow({ type: 'INTERNAL', definition: null })
        .fits,
    ).toBe(true);
    expect(
      checkSurveyFitsReservationWindow({
        type: 'EXTERNAL',
        definition: 'corrupt',
      }).fits,
    ).toBe(true);
  });
});

describe('Decision E8-D6: completion capacity is reserved at attempt start', () => {
  const now = new Date('2026-09-26T12:00:00.000Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  const base = {
    now,
    limit: 3,
    windowSeconds: 3600,
    reservationSeconds: 1800,
  };

  it('counts completions in the window plus open attempts', () => {
    const result = evaluateCompletionCapacity({
      ...base,
      completionTimes: [minutesAgo(50)],
      openAttemptStartTimes: [minutesAgo(5)],
    });
    expect(result).toMatchObject({
      allowed: true,
      count: 2,
      completionsInWindow: 1,
      inProgressAttempts: 1,
      retryAt: null,
    });
  });

  it('blocks when open attempts fill the remaining capacity and frees at the earliest release', () => {
    // 2 completions (release at +10 and +40 min) + 1 open attempt (expires in 20 min).
    const result = evaluateCompletionCapacity({
      ...base,
      completionTimes: [minutesAgo(20), minutesAgo(50)],
      openAttemptStartTimes: [minutesAgo(10)],
    });
    expect(result.allowed).toBe(false);
    expect(result.count).toBe(3);
    expect(result.completionsInWindow).toBe(2);
    expect(result.inProgressAttempts).toBe(1);
    expect(result.retryAfterSeconds).toBe(10 * 60);
    expect(result.retryAt).toBe(new Date(now.getTime() + 10 * 60_000).toISOString());
    expect(result.anchor).toBe(result.retryAt);
  });

  it('frees a slot when an open attempt expires before any completion leaves', () => {
    const result = evaluateCompletionCapacity({
      ...base,
      completionTimes: [minutesAgo(5), minutesAgo(1)],
      openAttemptStartTimes: [minutesAgo(25)],
    });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(5 * 60);
  });

  it('ignores expired reservations and completions outside the window', () => {
    const result = evaluateCompletionCapacity({
      ...base,
      completionTimes: [minutesAgo(61), minutesAgo(60)],
      openAttemptStartTimes: [minutesAgo(30), minutesAgo(45)],
    });
    expect(result).toMatchObject({ allowed: true, count: 0 });
  });

  it('matches the rolling-window rule when no attempt is open', () => {
    const times = Array.from(
      { length: DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY.completionLimit },
      (_, i) => minutesAgo(59 - i),
    );
    const result = evaluateCompletionCapacity({
      ...base,
      limit: DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY.completionLimit,
      completionTimes: times,
      openAttemptStartTimes: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(60);
  });

  it('lets the 429 details carry the completions and open attempts', () => {
    expect(
      participationRateLimitDetailsSchema.safeParse({
        scope: 'COMPLETIONS',
        limit: 20,
        windowSeconds: 3600,
        retryAfterSeconds: 60,
        retryAt: now.toISOString(),
        policyVersion: PARTICIPATION_RATE_LIMIT_POLICY_VERSION,
        completionsInWindow: 18,
        inProgressAttempts: 2,
      }).success,
    ).toBe(true);
  });
});
