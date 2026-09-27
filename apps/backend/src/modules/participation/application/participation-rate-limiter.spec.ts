import { ParticipationRateLimiter } from './participation-rate-limiter';
import { ParticipationRateLimitedException } from './exceptions/participation.exceptions';
import { InMemoryParticipationRepository } from '../infrastructure/in-memory-participation.repository';
import { InMemoryRateLimitCounterStore } from '../../../common/security/in-memory-rate-limit-counter.store';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';

describe('ParticipationRateLimiter (Story 8.2, FR-46)', () => {
  const userId = 'user-1';
  const policy = {
    completionLimit: 2,
    completionWindowSeconds: 3600,
    burstLimit: 3,
    burstWindowSeconds: 60,
  };
  let now: Date;
  let repository: InMemoryParticipationRepository;
  let limiter: ParticipationRateLimiter;

  function completed(id: string, submittedAt: Date, respondentId = userId) {
    repository.attempts.set(
      id,
      new SurveyAttemptEntity(
        id,
        'form-1',
        'version-1',
        respondentId,
        'COMPLETED',
        false,
        new Date(submittedAt.getTime() - 60_000),
        submittedAt,
        null,
        new Date(),
        new Date(),
      ),
    );
  }

  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  function open(id: string, startedAt: Date, formId = 'form-9') {
    repository.attempts.set(
      id,
      new SurveyAttemptEntity(
        id,
        formId,
        `version-${formId}`,
        userId,
        'IN_PROGRESS',
        false,
        startedAt,
        null,
        null,
        new Date(),
        new Date(),
      ),
    );
  }

  beforeEach(() => {
    now = new Date('2026-09-26T12:00:00.000Z');
    repository = new InMemoryParticipationRepository();
    limiter = new ParticipationRateLimiter(
      new InMemoryRateLimitCounterStore(),
      repository,
      policy,
      () => now,
    );
  });

  describe('per-user request bursts (ephemeral counters)', () => {
    it('allows up to the burst limit per user and action', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          limiter.assertBurstAllowed(userId, 'INTERNAL_SUBMISSION'),
        ).resolves.toBeUndefined();
      }
      // Other users and other actions have their own counters.
      await expect(
        limiter.assertBurstAllowed('user-2', 'INTERNAL_SUBMISSION'),
      ).resolves.toBeUndefined();
      await expect(
        limiter.assertBurstAllowed(userId, 'ATTEMPT_START'),
      ).resolves.toBeUndefined();
    });

    it('rejects with 429 details and records RATE_LIMIT evidence once per window', async () => {
      for (let i = 0; i < 3; i++) {
        await limiter.assertBurstAllowed(userId, 'ATTEMPT_START');
      }
      now = new Date(now.getTime() + 15_000);

      const rejection = limiter.assertBurstAllowed(userId, 'ATTEMPT_START');
      await expect(rejection).rejects.toBeInstanceOf(
        ParticipationRateLimitedException,
      );
      await rejection.catch((error: ParticipationRateLimitedException) => {
        expect(error.details).toEqual({
          scope: 'ATTEMPT_START',
          limit: 3,
          windowSeconds: 60,
          retryAfterSeconds: 45,
          retryAt: '2026-09-26T12:01:00.000Z',
          policyVersion: 'participation-rate-limit-v1',
        });
      });
      await expect(
        limiter.assertBurstAllowed(userId, 'ATTEMPT_START'),
      ).rejects.toBeInstanceOf(ParticipationRateLimitedException);

      expect(repository.fraudLogs).toHaveLength(1);
      expect(repository.fraudLogs[0]).toMatchObject({
        userId,
        type: 'RATE_LIMIT',
        dedupeKey: `rate-limit:${userId}:ATTEMPT_START:${new Date('2026-09-26T12:00:00.000Z').getTime()}`,
        details: expect.objectContaining({
          scope: 'ATTEMPT_START',
          requestsInWindow: 4,
        }),
      });
    });

    it('records the requested survey, response and attempt in the burst evidence (FR-47); the 429 body is unchanged', async () => {
      const target = {
        formId: 'form-7',
        responseId: 'response-7',
        attemptId: 'attempt-7',
      };
      for (let i = 0; i < 3; i++) {
        await limiter.assertBurstAllowed(userId, 'INTERNAL_SUBMISSION', target);
      }

      const error = (await limiter
        .assertBurstAllowed(userId, 'INTERNAL_SUBMISSION', target)
        .catch((e: unknown) => e)) as ParticipationRateLimitedException;

      expect(error).toBeInstanceOf(ParticipationRateLimitedException);
      expect(Object.keys(error.details).sort()).toEqual(
        [
          'limit',
          'policyVersion',
          'retryAfterSeconds',
          'retryAt',
          'scope',
          'windowSeconds',
        ].sort(),
      );
      expect(repository.fraudLogs[0].details).toEqual(
        expect.objectContaining({
          scope: 'INTERNAL_SUBMISSION',
          requestedFormId: 'form-7',
          requestedResponseId: 'response-7',
          requestedAttemptId: 'attempt-7',
        }),
      );
    });

    it('records only the requested ids that are present', async () => {
      for (let i = 0; i < 4; i++) {
        await limiter
          .assertBurstAllowed(userId, 'COMPLETION_CODE', {
            formId: null,
            attemptId: 'attempt-8',
          })
          .catch(() => undefined);
      }

      const details = repository.fraudLogs[0].details!;
      expect(details.requestedAttemptId).toBe('attempt-8');
      expect(details).not.toHaveProperty('requestedFormId');
      expect(details).not.toHaveProperty('requestedResponseId');
    });

    it('opens a new window (and new evidence) after the burst window', async () => {
      for (let i = 0; i < 4; i++) {
        await limiter
          .assertBurstAllowed(userId, 'COMPLETION_CODE')
          .catch(() => undefined);
      }
      now = new Date(now.getTime() + 60_000);

      await expect(
        limiter.assertBurstAllowed(userId, 'COMPLETION_CODE'),
      ).resolves.toBeUndefined();
      expect(repository.fraudLogs).toHaveLength(1);
    });
  });

  describe('durable completion limit (PostgreSQL-authoritative)', () => {
    it('allows while completions in the rolling window stay below the limit', async () => {
      completed('a', minutesAgo(61)); // outside the window
      completed('b', minutesAgo(10));
      completed('c', minutesAgo(5), 'someone-else');

      await expect(
        limiter.assertStartCapacity(userId, {
          action: 'ATTEMPT_START',
          formId: 'form-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a start at the limit with the exact retry time and one evidence row per window', async () => {
      completed('a', minutesAgo(40));
      completed('b', minutesAgo(10));

      const attempt = () =>
        limiter.assertStartCapacity(userId, {
          action: 'ATTEMPT_START',
          formId: 'form-2',
        });

      await expect(attempt()).rejects.toMatchObject({
        code: 'PARTICIPATION_RATE_LIMITED',
        details: {
          scope: 'COMPLETIONS',
          limit: 2,
          windowSeconds: 3600,
          retryAfterSeconds: 20 * 60,
          retryAt: new Date(minutesAgo(40).getTime() + 3_600_000).toISOString(),
          policyVersion: 'participation-rate-limit-v1',
          completionsInWindow: 2,
          inProgressAttempts: 0,
        },
      });
      await expect(attempt()).rejects.toBeInstanceOf(
        ParticipationRateLimitedException,
      );

      // Keyed by the release of the blocking completion: one row per window.
      expect(repository.fraudLogs).toHaveLength(1);
      expect(repository.fraudLogs[0]).toMatchObject({
        type: 'RATE_LIMIT',
        dedupeKey: `rate-limit:${userId}:COMPLETIONS:${new Date(minutesAgo(40).getTime() + 3_600_000).toISOString()}`,
        details: expect.objectContaining({
          completionsInWindow: 2,
          inProgressAttempts: 0,
          blockedAction: 'ATTEMPT_START',
          formId: 'form-2',
        }),
      });
    });

    describe('decision E8-D6: capacity is reserved at attempt start', () => {
      it("counts the user's open attempts on any form as reserved capacity", async () => {
        completed('a', minutesAgo(40));
        open('open-1', minutesAgo(10)); // expires in 20 min

        await expect(
          limiter.assertStartCapacity(userId, {
            action: 'ATTEMPT_START',
            formId: 'form-2',
          }),
        ).rejects.toMatchObject({
          code: 'PARTICIPATION_RATE_LIMITED',
          message: expect.stringContaining('still have in progress'),
          details: {
            scope: 'COMPLETIONS',
            completionsInWindow: 1,
            inProgressAttempts: 1,
            // The open attempt's reservation frees first (expiry in 20 min).
            retryAfterSeconds: 20 * 60,
          },
        });
      });

      it('releases the reservation of an expired, abandoned or locked attempt', async () => {
        completed('a', minutesAgo(40));
        open('expired', minutesAgo(31));
        repository.attempts.set(
          'locked',
          new SurveyAttemptEntity(
            'locked',
            'form-8',
            'version-8',
            userId,
            'LOCKED',
            false,
            minutesAgo(5),
            null,
            null,
            new Date(),
            new Date(),
          ),
        );

        await expect(
          limiter.assertStartCapacity(userId, { action: 'ATTEMPT_START' }),
        ).resolves.toBeUndefined();
      });

      it('does not count a reserved attempt twice once it completes', async () => {
        completed('a', minutesAgo(40));
        open('open-1', minutesAgo(10));
        // The open attempt completes: 2 completions, 0 open — still 2.
        completed('open-1', minutesAgo(1));

        await expect(
          limiter.assertStartCapacity(userId, { action: 'ATTEMPT_START' }),
        ).rejects.toMatchObject({
          details: { completionsInWindow: 2, inProgressAttempts: 0 },
        });
      });

      it('refuses a raced start from the transaction lists with the same evidence key', async () => {
        await expect(
          limiter.rejectStartCapacity(
            userId,
            [minutesAgo(40)],
            [minutesAgo(10)],
            { action: 'ATTEMPT_START', formId: 'form-4' },
            now,
          ),
        ).rejects.toMatchObject({
          details: {
            scope: 'COMPLETIONS',
            completionsInWindow: 1,
            inProgressAttempts: 1,
            retryAfterSeconds: 20 * 60,
          },
        });
        completed('a', minutesAgo(40));
        open('open-1', minutesAgo(10));
        await expect(
          limiter.assertStartCapacity(userId, { action: 'ATTEMPT_START' }),
        ).rejects.toBeInstanceOf(ParticipationRateLimitedException);
        expect(repository.fraudLogs).toHaveLength(1);
      });
    });

    it('hands the completion transactions the central policy and its clock (Epic 8 review P3)', () => {
      expect(limiter.completionLimitCheck(userId)).toEqual({
        userId,
        limit: 2,
        windowSeconds: 3600,
        now,
      });
    });

    it('rejects a raced completion from the transaction times with the same once-per-window evidence (Epic 8 review P3)', async () => {
      const times = [minutesAgo(40), minutesAgo(10)];

      await expect(
        limiter.rejectCompletions(
          userId,
          times,
          { action: 'COMPLETION_CODE', formId: 'form-3', attemptId: 'a-3' },
          now,
        ),
      ).rejects.toMatchObject({
        code: 'PARTICIPATION_RATE_LIMITED',
        details: {
          scope: 'COMPLETIONS',
          limit: 2,
          windowSeconds: 3600,
          retryAfterSeconds: 20 * 60,
          retryAt: new Date(minutesAgo(40).getTime() + 3_600_000).toISOString(),
          policyVersion: 'participation-rate-limit-v1',
        },
      });
      expect(repository.fraudLogs).toEqual([
        expect.objectContaining({
          type: 'RATE_LIMIT',
          dedupeKey: `rate-limit:${userId}:COMPLETIONS:${minutesAgo(40).toISOString()}`,
          details: expect.objectContaining({
            completionsInWindow: 2,
            blockedAction: 'COMPLETION_CODE',
            formId: 'form-3',
            attemptId: 'a-3',
          }),
        }),
      ]);

      // A repeat in the same window adds no second entry.
      await expect(
        limiter.rejectCompletions(
          userId,
          times,
          { action: 'INTERNAL_SUBMISSION' },
          now,
        ),
      ).rejects.toBeInstanceOf(ParticipationRateLimitedException);
      expect(repository.fraudLogs).toHaveLength(1);
    });

    it('still enforces the limit when evidence cannot be recorded', async () => {
      completed('a', minutesAgo(40));
      completed('b', minutesAgo(10));
      jest
        .spyOn(repository, 'recordFraudLog')
        .mockRejectedValue(new Error('db down'));

      await expect(
        limiter.assertStartCapacity(userId, { action: 'ATTEMPT_START' }),
      ).rejects.toBeInstanceOf(ParticipationRateLimitedException);
    });
  });

  describe('decision E8-D4: the policy version is stamped on every rejection', () => {
    const versioned = {
      ...policy,
      policyVersion: 'participation-rate-limit-2026-10-pilot',
    };

    beforeEach(() => {
      limiter = new ParticipationRateLimiter(
        new InMemoryRateLimitCounterStore(),
        repository,
        versioned,
        () => now,
      );
    });

    it('defaults to participation-rate-limit-v1 when the policy names no version', () => {
      expect(
        new ParticipationRateLimiter(
          new InMemoryRateLimitCounterStore(),
          repository,
          policy,
        ).policyVersion,
      ).toBe('participation-rate-limit-v1');
      expect(limiter.policyVersion).toBe(
        'participation-rate-limit-2026-10-pilot',
      );
    });

    it('stamps the configured version on burst 429s and their FraudLog entry', async () => {
      for (let i = 0; i < 3; i++) {
        await limiter.assertBurstAllowed(userId, 'COMPLETION_CODE');
      }
      const error = await limiter
        .assertBurstAllowed(userId, 'COMPLETION_CODE')
        .catch((e: ParticipationRateLimitedException) => e);

      expect(error).toBeInstanceOf(ParticipationRateLimitedException);
      expect(
        (error as ParticipationRateLimitedException).details.policyVersion,
      ).toBe('participation-rate-limit-2026-10-pilot');
      expect(repository.fraudLogs[0].details).toMatchObject({
        policyVersion: 'participation-rate-limit-2026-10-pilot',
      });
    });

    it('stamps it on the start reservation and the completion backstop too', async () => {
      completed('done-1', minutesAgo(10));
      completed('done-2', minutesAgo(5));

      const start = await limiter
        .assertStartCapacity(userId, { action: 'ATTEMPT_START' })
        .catch((e: ParticipationRateLimitedException) => e);
      const backstop = await limiter
        .rejectCompletions(userId, [minutesAgo(10), minutesAgo(5)], {
          action: 'INTERNAL_SUBMISSION',
        })
        .catch((e: ParticipationRateLimitedException) => e);

      for (const error of [start, backstop]) {
        expect(error).toBeInstanceOf(ParticipationRateLimitedException);
        expect(
          (error as ParticipationRateLimitedException).details.policyVersion,
        ).toBe('participation-rate-limit-2026-10-pilot');
      }
      expect(
        repository.fraudLogs.map(
          (entry) => (entry.details as { policyVersion: string }).policyVersion,
        ),
      ).toEqual(
        repository.fraudLogs.map(
          () => 'participation-rate-limit-2026-10-pilot',
        ),
      );
      expect(repository.fraudLogs.length).toBeGreaterThan(0);
    });
  });
});
