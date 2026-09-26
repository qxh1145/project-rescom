import { PrismaParticipationRepository } from './prisma-participation.repository';
import { InMemoryParticipationRepository } from './in-memory-participation.repository';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';

describe('Story 8.2 participation repository evidence & counters', () => {
  describe('PrismaParticipationRepository', () => {
    function createRepository() {
      const prisma = {
        fraudLog: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        surveyAttempt: {
          findMany: jest.fn(),
        },
      };
      return {
        prisma,
        repository: new PrismaParticipationRepository(prisma as any),
      };
    }

    it('appends FraudLog evidence with ON CONFLICT DO NOTHING semantics (never updates)', async () => {
      const { prisma, repository } = createRepository();

      const written = await repository.recordFraudLog(
        'user-1',
        'TIME_BARRIER',
        { attemptId: 'attempt-1' },
        'time-barrier:attempt-1',
      );

      expect(written).toBe(true);
      expect(prisma.fraudLog.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'user-1',
            type: 'TIME_BARRIER',
            details: { attemptId: 'attempt-1' },
            dedupeKey: 'time-barrier:attempt-1',
          },
        ],
        skipDuplicates: true,
      });
      expect(prisma.fraudLog.update).not.toHaveBeenCalled();
      expect(prisma.fraudLog.delete).not.toHaveBeenCalled();
    });

    it('reports a deduplicated write as not written', async () => {
      const { prisma, repository } = createRepository();
      prisma.fraudLog.createMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.recordFraudLog('user-1', 'RATE_LIMIT', {}, 'rate-limit:x'),
      ).resolves.toBe(false);
    });

    it('keeps legacy callers without a dedupe key working', async () => {
      const { prisma, repository } = createRepository();

      await repository.recordFraudLog('user-1', 'SECURITY_VIOLATION');

      expect(prisma.fraudLog.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'user-1',
            type: 'SECURITY_VIOLATION',
            details: undefined,
            dedupeKey: null,
          },
        ],
        skipDuplicates: true,
      });
    });

    it('reads completed attempt times for the rolling window from PostgreSQL', async () => {
      const { prisma, repository } = createRepository();
      const first = new Date('2026-09-26T10:00:00.000Z');
      const second = new Date('2026-09-26T10:30:00.000Z');
      prisma.surveyAttempt.findMany.mockResolvedValue([
        { submittedAt: first },
        { submittedAt: second },
        { submittedAt: null },
      ]);
      const since = new Date('2026-09-26T09:45:00.000Z');

      const times = await repository.findCompletionTimesSince('user-1', since);

      expect(times).toEqual([first, second]);
      expect(prisma.surveyAttempt.findMany).toHaveBeenCalledWith({
        where: {
          respondentId: 'user-1',
          status: 'COMPLETED',
          submittedAt: { gte: since },
        },
        select: { submittedAt: true },
        orderBy: { submittedAt: 'asc' },
        take: 1000,
      });
    });
  });

  describe('InMemoryParticipationRepository', () => {
    function attempt(
      id: string,
      respondentId: string | null,
      status: 'COMPLETED' | 'IN_PROGRESS',
      submittedAt: Date | null,
    ) {
      return new SurveyAttemptEntity(
        id,
        'form-1',
        'version-1',
        respondentId,
        status,
        false,
        new Date('2026-09-26T09:00:00.000Z'),
        submittedAt,
        null,
        new Date(),
        new Date(),
      );
    }

    it('writes a deduplicated FraudLog entry once', async () => {
      const repository = new InMemoryParticipationRepository();

      await expect(
        repository.recordFraudLog('user-1', 'RATE_LIMIT', {}, 'key-1'),
      ).resolves.toBe(true);
      await expect(
        repository.recordFraudLog('user-1', 'RATE_LIMIT', {}, 'key-1'),
      ).resolves.toBe(false);
      await expect(
        repository.recordFraudLog('user-1', 'RATE_LIMIT', {}),
      ).resolves.toBe(true);
      await expect(
        repository.recordFraudLog('user-1', 'RATE_LIMIT', {}),
      ).resolves.toBe(true);

      expect(repository.fraudLogs).toHaveLength(3);
    });

    it('returns only the respondent completions inside the window, oldest first', async () => {
      const repository = new InMemoryParticipationRepository();
      const since = new Date('2026-09-26T10:00:00.000Z');
      const later = new Date('2026-09-26T10:40:00.000Z');
      const earlier = new Date('2026-09-26T10:05:00.000Z');
      repository.attempts.set('a', attempt('a', 'user-1', 'COMPLETED', later));
      repository.attempts.set(
        'b',
        attempt('b', 'user-1', 'COMPLETED', earlier),
      );
      repository.attempts.set(
        'c',
        attempt(
          'c',
          'user-1',
          'COMPLETED',
          new Date('2026-09-26T09:59:59.000Z'),
        ),
      );
      repository.attempts.set('d', attempt('d', 'user-1', 'IN_PROGRESS', null));
      repository.attempts.set('e', attempt('e', 'user-2', 'COMPLETED', later));

      await expect(
        repository.findCompletionTimesSince('user-1', since),
      ).resolves.toEqual([earlier, later]);
    });

    describe('completion limit in the completion transactions (Epic 8 review P3)', () => {
      const now = new Date('2026-09-26T12:00:00.000Z');
      const completionLimit = {
        userId: 'user-1',
        limit: 2,
        windowSeconds: 3600,
        now,
      };
      const first = new Date('2026-09-26T11:10:00.000Z');
      const second = new Date('2026-09-26T11:50:00.000Z');

      async function seed(type: 'INTERNAL' | 'EXTERNAL') {
        const repository = new InMemoryParticipationRepository();
        repository.attempts.set(
          'done-1',
          attempt('done-1', 'user-1', 'COMPLETED', first),
        );
        repository.attempts.set(
          'done-2',
          attempt('done-2', 'user-1', 'COMPLETED', second),
        );
        // Outside the window, and another user's: never counted.
        repository.attempts.set(
          'old',
          attempt(
            'old',
            'user-1',
            'COMPLETED',
            new Date('2026-09-26T11:00:00.000Z'),
          ),
        );
        repository.attempts.set(
          'other',
          attempt('other', 'user-2', 'COMPLETED', second),
        );
        const { response } = await repository.createAttemptWithResponse({
          attemptId: 'current',
          formId: 'form-2',
          formVersionId: 'version-2',
          respondentId: 'user-1',
          isGuest: false,
          formType: type,
          ipAddress: '127.0.0.1',
          startedAt: new Date('2026-09-26T11:55:00.000Z'),
        });
        return { repository, response };
      }

      function submitParams(responseId: string) {
        return {
          responseId,
          attemptId: 'current',
          formId: 'form-2',
          formVersionId: 'version-2',
          respondentId: 'user-1',
          isGuest: false,
          answers: { q1: 'a' },
          submittedAt: now,
          policyMode: 'SHADOW' as const,
          policyDeploymentId: 'policy-default-v1',
          rewardAmount: 10,
          publisherId: 'publisher-1',
        };
      }

      const externalParams = {
        attemptId: 'current',
        respondentId: 'user-1',
        formId: 'form-2',
        formVersionId: 'version-2',
        submittedAt: now,
      };

      it('Internal: RATE_LIMITED at the limit with the window times, and nothing written', async () => {
        const { repository, response } = await seed('INTERNAL');

        await expect(
          repository.submitInternalResponseTransaction({
            ...submitParams(response!.id),
            completionLimit,
          }),
        ).resolves.toEqual({
          outcome: 'RATE_LIMITED',
          completionTimes: [first, second],
        });
        expect(repository.attempts.get('current')?.status).toBe('IN_PROGRESS');
        expect(repository.responses.get(response!.id)?.status).toBe(
          'IN_PROGRESS',
        );
        expect(repository.outboxEvents).toHaveLength(0);
      });

      it('Internal: submits below the limit, and without a limit', async () => {
        const below = await seed('INTERNAL');
        await expect(
          below.repository.submitInternalResponseTransaction({
            ...submitParams(below.response!.id),
            completionLimit: { ...completionLimit, limit: 3 },
          }),
        ).resolves.toMatchObject({ outcome: 'SUBMITTED' });

        const unlimited = await seed('INTERNAL');
        await expect(
          unlimited.repository.submitInternalResponseTransaction(
            submitParams(unlimited.response!.id),
          ),
        ).resolves.toMatchObject({ outcome: 'SUBMITTED' });
      });

      it('Internal: a duplicate submit stays ALREADY_SUBMITTED at the limit', async () => {
        const { repository, response } = await seed('INTERNAL');
        await repository.submitInternalResponseTransaction(
          submitParams(response!.id),
        );

        await expect(
          repository.submitInternalResponseTransaction({
            ...submitParams(response!.id),
            completionLimit,
          }),
        ).resolves.toEqual({ outcome: 'ALREADY_SUBMITTED' });
      });

      it('External: RATE_LIMITED at the limit without claiming; below it the claim succeeds', async () => {
        const limited = await seed('EXTERNAL');
        const result =
          await limited.repository.completeExternalAttemptTransaction({
            ...externalParams,
            completionLimit,
          });
        expect(result).toMatchObject({
          outcome: 'RATE_LIMITED',
          completionTimes: [first, second],
        });
        expect(limited.repository.attempts.get('current')?.status).toBe(
          'IN_PROGRESS',
        );

        const below = await seed('EXTERNAL');
        await expect(
          below.repository.completeExternalAttemptTransaction({
            ...externalParams,
            completionLimit: { ...completionLimit, limit: 3 },
          }),
        ).resolves.toMatchObject({ outcome: 'COMPLETED' });
      });
    });
  });
});
