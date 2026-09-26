import {
  grantStarterPointsSchema,
  unlockStarterPointsSchema,
  expireStarterPointsSchema,
  starterPointsStatusSchema,
  expireStarterPointsResultSchema,
  activationSurveySchema,
  starterPointsUnlockResultSchema,
  STARTER_ACTIVATION_STATES,
  STARTER_POINTS_DEFAULT_AMOUNT,
  STARTER_POINTS_EXPIRY_DAYS,
  STARTER_POINTS_EXPIRY_BATCH_DEFAULT_LIMIT,
  STARTER_POINTS_EXPIRY_BATCH_MAX_LIMIT,
  encodeStarterPointsExpiryCursor,
  decodeStarterPointsExpiryCursor,
} from './starter-points.schema';

describe('Starter Points Schemas', () => {
  const validUserId = '11111111-1111-4111-8111-111111111111';

  describe('grantStarterPointsSchema', () => {
    it('accepts valid input with default amount of 100', () => {
      const parsed = grantStarterPointsSchema.parse({
        userId: validUserId,
      });

      expect(parsed.userId).toBe(validUserId);
      expect(parsed.amount).toBe(100);
      expect(STARTER_POINTS_DEFAULT_AMOUNT).toBe(100);
    });

    it('accepts custom positive integer amount', () => {
      const parsed = grantStarterPointsSchema.parse({
        userId: validUserId,
        amount: 200,
      });

      expect(parsed.amount).toBe(200);
    });

    it('rejects invalid userId format', () => {
      expect(() =>
        grantStarterPointsSchema.parse({
          userId: 'invalid-uuid',
        }),
      ).toThrow();
    });

    it('rejects zero or negative amount', () => {
      expect(() =>
        grantStarterPointsSchema.parse({
          userId: validUserId,
          amount: 0,
        }),
      ).toThrow();

      expect(() =>
        grantStarterPointsSchema.parse({
          userId: validUserId,
          amount: -50,
        }),
      ).toThrow();
    });

    it('rejects non-integer amount', () => {
      expect(() =>
        grantStarterPointsSchema.parse({
          userId: validUserId,
          amount: 100.5,
        }),
      ).toThrow();
    });
  });

  describe('unlockStarterPointsSchema', () => {
    it('accepts valid userId', () => {
      const parsed = unlockStarterPointsSchema.parse({
        userId: validUserId,
      });
      expect(parsed.userId).toBe(validUserId);
    });

    it('rejects missing or invalid userId', () => {
      expect(() => unlockStarterPointsSchema.parse({})).toThrow();
      expect(() =>
        unlockStarterPointsSchema.parse({ userId: 'not-a-uuid' }),
      ).toThrow();
    });
  });

  describe('expireStarterPointsSchema', () => {
    it('accepts empty input (defaults cutoffDate to undefined)', () => {
      const parsed = expireStarterPointsSchema.parse({});
      expect(parsed.cutoffDate).toBeUndefined();
      expect(STARTER_POINTS_EXPIRY_DAYS).toBe(30);
    });

    it('accepts valid ISO datetime string for cutoffDate', () => {
      const now = new Date().toISOString();
      const parsed = expireStarterPointsSchema.parse({ cutoffDate: now });
      expect(parsed.cutoffDate).toBe(now);
    });

    it('rejects invalid datetime format', () => {
      expect(() =>
        expireStarterPointsSchema.parse({ cutoffDate: 'not-a-date' }),
      ).toThrow();
    });

    it('bounds the batch size: default 100, integer 1..500', () => {
      expect(expireStarterPointsSchema.parse({}).limit).toBe(
        STARTER_POINTS_EXPIRY_BATCH_DEFAULT_LIMIT,
      );
      expect(STARTER_POINTS_EXPIRY_BATCH_DEFAULT_LIMIT).toBe(100);
      expect(expireStarterPointsSchema.parse({ limit: 1 }).limit).toBe(1);
      expect(
        expireStarterPointsSchema.parse({
          limit: STARTER_POINTS_EXPIRY_BATCH_MAX_LIMIT,
        }).limit,
      ).toBe(500);
      for (const limit of [0, -1, 501, 2.5, '10']) {
        expect(expireStarterPointsSchema.safeParse({ limit }).success).toBe(
          false,
        );
      }
    });

    it('accepts a cursor issued by encodeStarterPointsExpiryCursor as `after`', () => {
      const cursor = {
        registeredAt: '2026-08-01T10:00:00.000Z',
        userId: validUserId,
      };
      const token = encodeStarterPointsExpiryCursor(cursor);

      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeStarterPointsExpiryCursor(token)).toEqual(cursor);
      expect(expireStarterPointsSchema.parse({ after: token }).after).toBe(
        token,
      );
    });

    it('rejects a forged or malformed `after` cursor', () => {
      const valid = encodeStarterPointsExpiryCursor({
        registeredAt: '2026-08-01T10:00:00.000Z',
        userId: validUserId,
      });
      const base64Url = (json: string) =>
        Buffer.from(json).toString('base64url');
      const invalid = [
        '',
        'not a cursor!',
        `${valid}=`,
        `${valid}A`,
        base64Url('not json'),
        base64Url(JSON.stringify({ userId: validUserId })),
        base64Url(
          JSON.stringify({ registeredAt: 'yesterday', userId: validUserId }),
        ),
        base64Url(
          JSON.stringify({
            registeredAt: '2026-08-01T10:00:00.000Z',
            userId: 'not-a-uuid',
          }),
        ),
        base64Url(
          JSON.stringify({
            registeredAt: '2026-08-01T10:00:00.000Z',
            userId: validUserId,
            extra: true,
          }),
        ),
        'A'.repeat(300),
      ];

      for (const after of invalid) {
        expect(decodeStarterPointsExpiryCursor(after)).toBeNull();
        expect(expireStarterPointsSchema.safeParse({ after }).success).toBe(
          false,
        );
      }
      // Node's own base64url of the same JSON is the token we issue.
      expect(
        base64Url(
          JSON.stringify({
            registeredAt: '2026-08-01T10:00:00.000Z',
            userId: validUserId,
          }),
        ),
      ).toBe(valid);
    });
  });

  describe('starterPointsStatusSchema', () => {
    const validStatus = {
      userId: validUserId,
      isGranted: true,
      frozenBalance: 100,
      isDemographicComplete: false,
      hasCompletedMarketplaceSurvey: false,
      isUnlocked: false,
      isExpired: false,
      registeredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      daysRemaining: 30,
      unlockEligibility: {
        eligible: false,
        missingSteps: [
          'Complete Mandatory Demographic Survey',
          'Complete 1 Marketplace Survey',
        ],
      },
      activationState: 'DEMOGRAPHICS_REQUIRED',
      activatedAt: null,
      activationSurvey: null,
      isVerifiedMember: false,
    };

    it('accepts a fully populated valid status DTO', () => {
      const parsed = starterPointsStatusSchema.parse(validStatus);
      expect(parsed.userId).toBe(validUserId);
      expect(parsed.unlockEligibility.eligible).toBe(false);
      expect(parsed.unlockEligibility.missingSteps).toHaveLength(2);
    });

    it('accepts every activation state and an activation survey (Story 7.2)', () => {
      for (const activationState of STARTER_ACTIVATION_STATES) {
        expect(
          starterPointsStatusSchema.safeParse({ ...validStatus, activationState })
            .success,
        ).toBe(true);
      }
      const completedAt = new Date().toISOString();
      const parsed = starterPointsStatusSchema.parse({
        ...validStatus,
        activationState: 'ACTIVATED',
        activatedAt: completedAt,
        activationSurvey: {
          source: 'INTERNAL',
          formId: 'form-1',
          completedAt,
          confirmsAt: completedAt,
          status: 'CONFIRMED',
        },
      });
      expect(parsed.activationSurvey?.status).toBe('CONFIRMED');
    });

    it('rejects an unknown activation state or a missing activation field', () => {
      expect(
        starterPointsStatusSchema.safeParse({
          ...validStatus,
          activationState: 'ALMOST',
        }).success,
      ).toBe(false);
      const { activationState: _omit, ...withoutState } = validStatus;
      expect(starterPointsStatusSchema.safeParse(withoutState).success).toBe(
        false,
      );
      expect(
        activationSurveySchema.safeParse({
          source: 'PAPER',
          formId: 'f',
          completedAt: new Date().toISOString(),
          confirmsAt: new Date().toISOString(),
          status: 'CONFIRMED',
        }).success,
      ).toBe(false);
    });

    it('requires the Verified Member flag (decision E7-DN3)', () => {
      const { isVerifiedMember: _omit, ...withoutFlag } = validStatus;
      expect(starterPointsStatusSchema.safeParse(withoutFlag).success).toBe(
        false,
      );
      expect(
        starterPointsStatusSchema.parse({
          ...validStatus,
          activationState: 'EXPIRED',
          isExpired: true,
          isVerifiedMember: true,
        }).isVerifiedMember,
      ).toBe(true);
    });

    it('rejects negative days remaining or negative balance', () => {
      expect(() =>
        starterPointsStatusSchema.parse({
          ...validStatus,
          frozenBalance: -10,
        }),
      ).toThrow();

      expect(() =>
        starterPointsStatusSchema.parse({
          ...validStatus,
          daysRemaining: -1,
        }),
      ).toThrow();
    });
  });

  describe('expireStarterPointsResultSchema', () => {
    it('validates a correct batch expiry result', () => {
      const result = {
        scannedCount: 10,
        expiredCount: 2,
        expiredUserIds: [validUserId],
        totalPointsVoided: 200,
        unlockedUserIds: [],
        deferredCount: 1,
        failedCount: 0,
        timestamp: new Date().toISOString(),
      };

      const parsed = expireStarterPointsResultSchema.parse(result);
      expect(parsed.scannedCount).toBe(10);
      expect(parsed.expiredCount).toBe(2);
      expect(parsed.totalPointsVoided).toBe(200);
    });

    it('carries an optional nextCursor: a cursor token or null', () => {
      const result = {
        scannedCount: 1,
        expiredCount: 0,
        expiredUserIds: [],
        totalPointsVoided: 0,
        unlockedUserIds: [],
        deferredCount: 1,
        failedCount: 0,
        timestamp: new Date().toISOString(),
      };
      const nextCursor = encodeStarterPointsExpiryCursor({
        registeredAt: '2026-08-01T10:00:00.000Z',
        userId: validUserId,
      });

      expect(
        expireStarterPointsResultSchema.parse({ ...result, nextCursor })
          .nextCursor,
      ).toBe(nextCursor);
      expect(
        expireStarterPointsResultSchema.parse({ ...result, nextCursor: null })
          .nextCursor,
      ).toBeNull();
      expect(
        expireStarterPointsResultSchema.safeParse({
          ...result,
          nextCursor: 'garbage',
        }).success,
      ).toBe(false);
    });

    it('rejects negative counts or voided points', () => {
      expect(() =>
        expireStarterPointsResultSchema.parse({
          scannedCount: -1,
          expiredCount: 0,
          expiredUserIds: [],
          totalPointsVoided: 0,
          unlockedUserIds: [],
          deferredCount: 0,
          failedCount: 0,
          timestamp: new Date().toISOString(),
        }),
      ).toThrow();

      expect(() =>
        expireStarterPointsResultSchema.parse({
          scannedCount: 0,
          expiredCount: 0,
          expiredUserIds: [],
          totalPointsVoided: 0,
          unlockedUserIds: [],
          deferredCount: -1,
          failedCount: 0,
          timestamp: new Date().toISOString(),
        }),
      ).toThrow();
    });
  });
  describe('starterPointsUnlockResultSchema (Story 7.2)', () => {
    it('accepts unlocked and not-yet-eligible results', () => {
      expect(
        starterPointsUnlockResultSchema.parse({
          unlocked: true,
          amount: 100,
          journalId: 'journal-1',
          activationState: 'ACTIVATED',
        }).unlocked,
      ).toBe(true);
      expect(
        starterPointsUnlockResultSchema.parse({
          unlocked: false,
          reason: 'Waiting for the 48-hour review of your External survey completion.',
          missingSteps: ['Complete 1 Marketplace Survey'],
          activationState: 'PENDING_CONFIRMATION',
        }).activationState,
      ).toBe('PENDING_CONFIRMATION');
    });

    it('rejects a malformed result', () => {
      expect(starterPointsUnlockResultSchema.safeParse({}).success).toBe(false);
      expect(
        starterPointsUnlockResultSchema.safeParse({
          unlocked: true,
          amount: -1,
        }).success,
      ).toBe(false);
    });
  });
});
