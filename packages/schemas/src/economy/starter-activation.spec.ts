import {
  evaluateStarterActivation,
  EvaluateStarterActivationInput,
  isStarterActivationRewardEligible,
  StarterActivationCompletion,
} from './starter-activation';
import {
  EXTERNAL_COMPLETION_REVIEW_HOURS,
  STARTER_ACTIVATION_MIN_SURVEY_REWARD,
  STARTER_ACTIVATION_MISSING_STEPS,
  STARTER_POINTS_EXPIRY_DAYS,
} from './starter-points.schema';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('evaluateStarterActivation (Story 7.2, FR-5/FR-7/FR-8)', () => {
  const registeredAt = new Date('2026-09-01T00:00:00.000Z');
  const expiresAt = new Date(
    registeredAt.getTime() + STARTER_POINTS_EXPIRY_DAYS * DAY,
  );

  type CompletionOverride = Omit<
    StarterActivationCompletion,
    'rewardPerResponse'
  > & { rewardPerResponse?: number };

  /** Completions default to a rewarded (10-point) survey unless stated. */
  function input(
    overrides: Partial<Omit<EvaluateStarterActivationInput, 'completions'>> & {
      completions?: readonly CompletionOverride[];
    } = {},
  ): EvaluateStarterActivationInput {
    const { completions = [], ...rest } = overrides;
    return {
      now: new Date(registeredAt.getTime() + 2 * DAY),
      registeredAt,
      isGranted: true,
      frozenBalance: 100,
      isDemographicComplete: true,
      unlockedAt: null,
      expiredAt: null,
      ...rest,
      completions: completions.map((completion) => ({
        rewardPerResponse: 10,
        ...completion,
      })),
    };
  }

  it('uses a 48-hour External review window', () => {
    expect(EXTERNAL_COMPLETION_REVIEW_HOURS).toBe(48);
  });

  it('requires the demographic survey first', () => {
    const result = evaluateStarterActivation(
      input({ isDemographicComplete: false }),
    );
    expect(result.state).toBe('DEMOGRAPHICS_REQUIRED');
    expect(result.eligible).toBe(false);
    expect(result.missingSteps).toEqual([
      STARTER_ACTIVATION_MISSING_STEPS.DEMOGRAPHICS,
      STARTER_ACTIVATION_MISSING_STEPS.MARKETPLACE_SURVEY,
    ]);
  });

  it('prompts for one Marketplace survey once the profile is complete', () => {
    const result = evaluateStarterActivation(input());
    expect(result.state).toBe('SURVEY_REQUIRED');
    expect(result.hasQualifyingSurvey).toBe(false);
    expect(result.missingSteps).toEqual([
      STARTER_ACTIVATION_MISSING_STEPS.MARKETPLACE_SURVEY,
    ]);
    expect(result.expiresAt.toISOString()).toBe(expiresAt.toISOString());
    expect(result.daysRemaining).toBe(28);
    expect(result.activationSurvey).toBeNull();
  });

  it('counts an Internal completion immediately', () => {
    const completedAt = new Date(registeredAt.getTime() + DAY);
    const result = evaluateStarterActivation(
      input({
        completions: [{ source: 'INTERNAL', formId: 'form-1', completedAt }],
      }),
    );
    expect(result.state).toBe('READY_TO_UNLOCK');
    expect(result.eligible).toBe(true);
    expect(result.hasQualifyingSurvey).toBe(true);
    expect(result.missingSteps).toEqual([]);
    expect(result.activationSurvey).toEqual({
      source: 'INTERNAL',
      formId: 'form-1',
      completedAt: completedAt.toISOString(),
      confirmsAt: completedAt.toISOString(),
      status: 'CONFIRMED',
    });
  });

  it('keeps an External completion pending for 48 hours after verification', () => {
    const completedAt = new Date(registeredAt.getTime() + DAY);
    const now = new Date(completedAt.getTime() + 47 * HOUR);
    const result = evaluateStarterActivation(
      input({
        now,
        completions: [{ source: 'EXTERNAL', formId: 'ext-1', completedAt }],
      }),
    );
    expect(result.state).toBe('PENDING_CONFIRMATION');
    expect(result.eligible).toBe(false);
    expect(result.hasQualifyingSurvey).toBe(false);
    expect(result.activationSurvey).toMatchObject({
      source: 'EXTERNAL',
      status: 'PENDING_REVIEW',
      confirmsAt: new Date(completedAt.getTime() + 48 * HOUR).toISOString(),
    });
  });

  it('confirms an External completion exactly when the review window closes', () => {
    const completedAt = new Date(registeredAt.getTime() + DAY);
    const result = evaluateStarterActivation(
      input({
        now: new Date(completedAt.getTime() + 48 * HOUR),
        completions: [{ source: 'EXTERNAL', formId: 'ext-1', completedAt }],
      }),
    );
    expect(result.state).toBe('READY_TO_UNLOCK');
    expect(result.activationSurvey?.status).toBe('CONFIRMED');
  });

  it('prefers the completion that confirms first (Internal after a pending External)', () => {
    const externalAt = new Date(registeredAt.getTime() + DAY);
    const internalAt = new Date(externalAt.getTime() + HOUR);
    const result = evaluateStarterActivation(
      input({
        now: new Date(internalAt.getTime() + HOUR),
        completions: [
          { source: 'EXTERNAL', formId: 'ext-1', completedAt: externalAt },
          { source: 'INTERNAL', formId: 'int-1', completedAt: internalAt },
        ],
      }),
    );
    expect(result.state).toBe('READY_TO_UNLOCK');
    expect(result.activationSurvey?.formId).toBe('int-1');
    expect(result.pendingSurvey?.formId).toBe('ext-1');
  });

  it('accepts ISO strings as completion times', () => {
    const result = evaluateStarterActivation(
      input({
        completions: [
          {
            source: 'INTERNAL',
            formId: 'form-1',
            completedAt: new Date(registeredAt.getTime() + DAY).toISOString(),
          },
        ],
      }),
    );
    expect(result.state).toBe('READY_TO_UNLOCK');
  });

  it('reports ACTIVATED once the unlock journal exists, whatever else is true', () => {
    const unlockedAt = new Date(registeredAt.getTime() + DAY);
    const result = evaluateStarterActivation(
      input({
        now: new Date(registeredAt.getTime() + 90 * DAY),
        frozenBalance: 0,
        isDemographicComplete: false,
        unlockedAt,
      }),
    );
    expect(result.state).toBe('ACTIVATED');
    expect(result.isUnlocked).toBe(true);
    expect(result.isExpired).toBe(false);
    expect(result.eligible).toBe(false);
    expect(result.missingSteps).toEqual([]);
  });

  it('reports EXPIRED once the expiry journal exists', () => {
    const result = evaluateStarterActivation(
      input({
        frozenBalance: 0,
        expiredAt: new Date(registeredAt.getTime() + 31 * DAY),
        completions: [
          {
            source: 'INTERNAL',
            formId: 'form-1',
            completedAt: new Date(registeredAt.getTime() + DAY),
          },
        ],
      }),
    );
    expect(result.state).toBe('EXPIRED');
    expect(result.isExpired).toBe(true);
    expect(result.eligible).toBe(false);
  });

  it('expires after the deadline when no in-window survey was completed', () => {
    const result = evaluateStarterActivation(
      input({ now: new Date(expiresAt.getTime() + 1) }),
    );
    expect(result.state).toBe('EXPIRED');
    expect(result.isDeadlinePassed).toBe(true);
    expect(result.daysRemaining).toBe(0);
  });

  it('does not count a completion made after the 30-day deadline', () => {
    const lateCompletion = new Date(expiresAt.getTime() + HOUR);
    const result = evaluateStarterActivation(
      input({
        now: new Date(lateCompletion.getTime() + HOUR),
        completions: [
          { source: 'INTERNAL', formId: 'late', completedAt: lateCompletion },
        ],
      }),
    );
    expect(result.state).toBe('EXPIRED');
    expect(result.hasQualifyingSurvey).toBe(false);
  });

  it('counts a completion made exactly at the deadline', () => {
    const result = evaluateStarterActivation(
      input({
        now: new Date(expiresAt.getTime() + HOUR),
        completions: [
          { source: 'INTERNAL', formId: 'edge', completedAt: expiresAt },
        ],
      }),
    );
    expect(result.state).toBe('READY_TO_UNLOCK');
  });

  it('allows a catch-up unlock after the deadline for an in-window completion', () => {
    const result = evaluateStarterActivation(
      input({
        now: new Date(expiresAt.getTime() + 5 * DAY),
        completions: [
          {
            source: 'INTERNAL',
            formId: 'form-1',
            completedAt: new Date(expiresAt.getTime() - DAY),
          },
        ],
      }),
    );
    expect(result.state).toBe('READY_TO_UNLOCK');
    expect(result.isExpired).toBe(false);
    expect(result.eligible).toBe(true);
  });

  it('waits for an in-window External review that ends after the deadline', () => {
    const completedAt = new Date(expiresAt.getTime() - HOUR);
    const pending = evaluateStarterActivation(
      input({
        now: new Date(expiresAt.getTime() + HOUR),
        completions: [{ source: 'EXTERNAL', formId: 'ext', completedAt }],
      }),
    );
    expect(pending.state).toBe('PENDING_CONFIRMATION');
    expect(pending.isExpired).toBe(false);

    const confirmed = evaluateStarterActivation(
      input({
        now: new Date(completedAt.getTime() + 48 * HOUR),
        completions: [{ source: 'EXTERNAL', formId: 'ext', completedAt }],
      }),
    );
    expect(confirmed.state).toBe('READY_TO_UNLOCK');
  });

  it('expires past the deadline when an in-window survey exists but the profile is incomplete (Epic 7 review P2, 7.2 AC4)', () => {
    // A completion never stands in for the demographic profile: it may have
    // been cleared later (PUT /demographics) or predate the 7.1 gate.
    const result = evaluateStarterActivation(
      input({
        now: new Date(expiresAt.getTime() + DAY),
        isDemographicComplete: false,
        completions: [
          {
            source: 'INTERNAL',
            formId: 'form-1',
            completedAt: new Date(registeredAt.getTime() + DAY),
          },
        ],
      }),
    );
    expect(result.state).toBe('EXPIRED');
    expect(result.isExpired).toBe(true);
    expect(result.eligible).toBe(false);
  });

  it('expires an in-window External review past the deadline once the profile is incomplete (Epic 7 review P2)', () => {
    const completedAt = new Date(expiresAt.getTime() - HOUR);
    const result = evaluateStarterActivation(
      input({
        now: new Date(expiresAt.getTime() + HOUR),
        isDemographicComplete: false,
        completions: [{ source: 'EXTERNAL', formId: 'ext', completedAt }],
      }),
    );
    expect(result.state).toBe('EXPIRED');
    expect(result.isExpired).toBe(true);
  });

  it('catches up past the deadline for an in-window completion while the profile is complete (Epic 7 review P2)', () => {
    const result = evaluateStarterActivation(
      input({
        now: new Date(expiresAt.getTime() + DAY),
        isDemographicComplete: true,
        completions: [
          {
            source: 'INTERNAL',
            formId: 'form-1',
            completedAt: new Date(registeredAt.getTime() + DAY),
          },
        ],
      }),
    );
    expect(result.state).toBe('READY_TO_UNLOCK');
    expect(result.isExpired).toBe(false);
    expect(result.eligible).toBe(true);
    expect(result.missingSteps).toEqual([]);
  });

  it('keeps EXPIRED stable past the deadline whatever the profile or later completions do', () => {
    const base = {
      now: new Date(expiresAt.getTime() + DAY),
      completions: [
        {
          source: 'INTERNAL' as const,
          formId: 'late',
          completedAt: new Date(expiresAt.getTime() + HOUR),
        },
      ],
    };
    expect(
      evaluateStarterActivation(input({ ...base, isDemographicComplete: false }))
        .state,
    ).toBe('EXPIRED');
    expect(
      evaluateStarterActivation(input({ ...base, isDemographicComplete: true }))
        .state,
    ).toBe('EXPIRED');
  });

  it('still requires the current profile before the deadline', () => {
    const result = evaluateStarterActivation(
      input({
        isDemographicComplete: false,
        completions: [
          {
            source: 'INTERNAL',
            formId: 'form-1',
            completedAt: new Date(registeredAt.getTime() + DAY),
          },
        ],
      }),
    );
    expect(result.state).toBe('DEMOGRAPHICS_REQUIRED');
    expect(result.eligible).toBe(false);
  });

  it('is only past the deadline in EXPIRED, READY_TO_UNLOCK, PENDING_CONFIRMATION, ACTIVATED or NOT_GRANTED', () => {
    const states = new Set<string>();
    for (const isDemographicComplete of [true, false]) {
      for (const completions of [
        [],
        [{ source: 'INTERNAL' as const, formId: 'a', completedAt: new Date(registeredAt.getTime() + DAY) }],
        [{ source: 'EXTERNAL' as const, formId: 'b', completedAt: new Date(expiresAt.getTime() - HOUR) }],
      ]) {
        states.add(
          evaluateStarterActivation(
            input({
              now: new Date(expiresAt.getTime() + HOUR),
              isDemographicComplete,
              completions,
            }),
          ).state,
        );
      }
    }
    expect([...states].sort()).toEqual([
      'EXPIRED',
      'PENDING_CONFIRMATION',
      'READY_TO_UNLOCK',
    ]);
  });

  it('reports NOT_GRANTED when there are no starter points to activate', () => {
    expect(
      evaluateStarterActivation(input({ isGranted: false, frozenBalance: 0 }))
        .state,
    ).toBe('NOT_GRANTED');
    expect(
      evaluateStarterActivation(input({ isGranted: true, frozenBalance: 0 }))
        .state,
    ).toBe('NOT_GRANTED');
  });

  it('never marks a user without starter points as expired', () => {
    const result = evaluateStarterActivation(
      input({
        isGranted: false,
        frozenBalance: 0,
        now: new Date(expiresAt.getTime() + DAY),
      }),
    );
    expect(result.isExpired).toBe(false);
    expect(result.state).toBe('NOT_GRANTED');
  });
  describe('decision E7-DN2 (B(1)): only surveys paying at least 1 point qualify', () => {
    it('defines the minimum as 1 point', () => {
      expect(STARTER_ACTIVATION_MIN_SURVEY_REWARD).toBe(1);
      expect(isStarterActivationRewardEligible(1)).toBe(true);
      expect(isStarterActivationRewardEligible(15)).toBe(true);
      expect(isStarterActivationRewardEligible(0)).toBe(false);
      expect(isStarterActivationRewardEligible(-5)).toBe(false);
      expect(isStarterActivationRewardEligible(Number.NaN)).toBe(false);
    });

    it('ignores a zero-reward Internal completion', () => {
      const result = evaluateStarterActivation(
        input({
          completions: [
            {
              source: 'INTERNAL',
              formId: 'free-form',
              completedAt: new Date(registeredAt.getTime() + DAY),
              rewardPerResponse: 0,
            },
          ],
        }),
      );
      expect(result.state).toBe('SURVEY_REQUIRED');
      expect(result.hasQualifyingSurvey).toBe(false);
      expect(result.activationSurvey).toBeNull();
      expect(result.isVerifiedMember).toBe(false);
    });

    it('ignores a zero-reward External completion, even after its review window', () => {
      const result = evaluateStarterActivation(
        input({
          now: new Date(registeredAt.getTime() + 5 * DAY),
          completions: [
            {
              source: 'EXTERNAL',
              formId: 'free-ext',
              completedAt: new Date(registeredAt.getTime() + DAY),
              rewardPerResponse: 0,
            },
          ],
        }),
      );
      expect(result.state).toBe('SURVEY_REQUIRED');
      expect(result.pendingSurvey).toBeNull();
    });

    it('counts a 1-point survey and prefers it over a free one', () => {
      const result = evaluateStarterActivation(
        input({
          completions: [
            {
              source: 'INTERNAL',
              formId: 'free-form',
              completedAt: new Date(registeredAt.getTime() + HOUR),
              rewardPerResponse: 0,
            },
            {
              source: 'INTERNAL',
              formId: 'one-point',
              completedAt: new Date(registeredAt.getTime() + DAY),
              rewardPerResponse: 1,
            },
          ],
        }),
      );
      expect(result.state).toBe('READY_TO_UNLOCK');
      expect(result.qualifyingSurvey?.formId).toBe('one-point');
    });
  });

  describe('decision E7-DN1: an early-closed review (mock demo control)', () => {
    const completedAt = new Date(registeredAt.getTime() + DAY);
    const now = new Date(completedAt.getTime() + HOUR);

    it('confirms an External completion at reviewClosedAt without moving completedAt', () => {
      const result = evaluateStarterActivation(
        input({
          now,
          completions: [
            {
              source: 'EXTERNAL',
              formId: 'ext-demo',
              completedAt,
              reviewClosedAt: now,
            },
          ],
        }),
      );
      expect(result.state).toBe('READY_TO_UNLOCK');
      expect(result.activationSurvey).toEqual({
        source: 'EXTERNAL',
        formId: 'ext-demo',
        completedAt: completedAt.toISOString(),
        confirmsAt: now.toISOString(),
        status: 'CONFIRMED',
      });
    });

    it('never confirms before completedAt or later than the 48-hour window', () => {
      const early = evaluateStarterActivation(
        input({
          now,
          completions: [
            {
              source: 'EXTERNAL',
              formId: 'ext-early',
              completedAt,
              reviewClosedAt: new Date(completedAt.getTime() - DAY),
            },
          ],
        }),
      );
      expect(early.activationSurvey?.confirmsAt).toBe(completedAt.toISOString());

      const late = evaluateStarterActivation(
        input({
          now,
          completions: [
            {
              source: 'EXTERNAL',
              formId: 'ext-late',
              completedAt,
              reviewClosedAt: new Date(completedAt.getTime() + 5 * DAY),
            },
          ],
        }),
      );
      expect(late.activationSurvey?.confirmsAt).toBe(
        new Date(completedAt.getTime() + 48 * HOUR).toISOString(),
      );
      expect(late.state).toBe('PENDING_CONFIRMATION');
    });

    it('keeps a completion made after the deadline out of the activation window', () => {
      const lateAt = new Date(expiresAt.getTime() + HOUR);
      const result = evaluateStarterActivation(
        input({
          now: new Date(lateAt.getTime() + HOUR),
          completions: [
            {
              source: 'EXTERNAL',
              formId: 'ext-after-deadline',
              completedAt: lateAt,
              reviewClosedAt: new Date(lateAt.getTime() + HOUR),
            },
          ],
        }),
      );
      expect(result.state).toBe('EXPIRED');
      expect(result.hasQualifyingSurvey).toBe(false);
      expect(result.isVerifiedMember).toBe(true);
    });
  });

  describe('decision E7-DN3: "Verified Member" is separate from the starter points', () => {
    const internalAt = (at: Date) => [
      { source: 'INTERNAL' as const, formId: 'form-v', completedAt: at },
    ];

    it('is false until both steps are done', () => {
      expect(evaluateStarterActivation(input()).isVerifiedMember).toBe(false);
      expect(
        evaluateStarterActivation(
          input({
            isDemographicComplete: false,
            completions: internalAt(new Date(registeredAt.getTime() + DAY)),
          }),
        ).isVerifiedMember,
      ).toBe(false);
    });

    it('is true once both steps are done, before and after the unlock', () => {
      const completions = internalAt(new Date(registeredAt.getTime() + DAY));
      const ready = evaluateStarterActivation(input({ completions }));
      expect(ready.state).toBe('READY_TO_UNLOCK');
      expect(ready.isVerifiedMember).toBe(true);

      const activated = evaluateStarterActivation(
        input({
          completions,
          frozenBalance: 0,
          unlockedAt: new Date(registeredAt.getTime() + DAY),
        }),
      );
      expect(activated.state).toBe('ACTIVATED');
      expect(activated.isVerifiedMember).toBe(true);
    });

    it('stays true for an activated account whose profile was later cleared', () => {
      const result = evaluateStarterActivation(
        input({
          isDemographicComplete: false,
          frozenBalance: 0,
          unlockedAt: new Date(registeredAt.getTime() + DAY),
        }),
      );
      expect(result.state).toBe('ACTIVATED');
      expect(result.isVerifiedMember).toBe(true);
    });

    it('is not granted by an External completion still under review', () => {
      const result = evaluateStarterActivation(
        input({
          completions: [
            {
              source: 'EXTERNAL',
              formId: 'ext-v',
              completedAt: new Date(registeredAt.getTime() + DAY + HOUR),
            },
          ],
        }),
      );
      expect(result.state).toBe('PENDING_CONFIRMATION');
      expect(result.isVerifiedMember).toBe(false);
    });

    it('lets an expired respondent become a Verified Member with a completion made after the deadline (only the points are forfeited)', () => {
      const now = new Date(expiresAt.getTime() + 5 * DAY);
      const lateCompletion = internalAt(new Date(expiresAt.getTime() + DAY));

      const expiredNoSurvey = evaluateStarterActivation(
        input({ now, expiredAt: new Date(expiresAt.getTime() + HOUR) }),
      );
      expect(expiredNoSurvey.state).toBe('EXPIRED');
      expect(expiredNoSurvey.isVerifiedMember).toBe(false);

      const expiredVerified = evaluateStarterActivation(
        input({
          now,
          frozenBalance: 0,
          expiredAt: new Date(expiresAt.getTime() + HOUR),
          completions: lateCompletion,
        }),
      );
      expect(expiredVerified.state).toBe('EXPIRED');
      expect(expiredVerified.isExpired).toBe(true);
      expect(expiredVerified.hasQualifyingSurvey).toBe(false);
      expect(expiredVerified.eligible).toBe(false);
      expect(expiredVerified.isVerifiedMember).toBe(true);
    });

    it('never counts a zero-reward survey toward the status either', () => {
      const result = evaluateStarterActivation(
        input({
          completions: [
            {
              source: 'INTERNAL',
              formId: 'free-form',
              completedAt: new Date(registeredAt.getTime() + DAY),
              rewardPerResponse: 0,
            },
          ],
        }),
      );
      expect(result.isVerifiedMember).toBe(false);
    });
  });
});
