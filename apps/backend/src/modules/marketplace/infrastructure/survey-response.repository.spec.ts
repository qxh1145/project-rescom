import { InMemorySurveyResponseRepository } from './in-memory-survey-response.repository';
import { PrismaSurveyResponseRepository } from './prisma-survey-response.repository';
import { PrismaService } from '../../../common/database/prisma.service';
import { InMemoryFormRepository } from '../../forms/infrastructure/in-memory-form.repository';
import { InMemoryParticipationRepository } from '../../participation/infrastructure/in-memory-participation.repository';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';

describe('Story 4.3: SurveyResponseRepository Implementations', () => {
  describe('InMemorySurveyResponseRepository', () => {
    let repo: InMemorySurveyResponseRepository;

    beforeEach(() => {
      repo = new InMemorySurveyResponseRepository();
    });

    it('should return empty set when respondent has no responses', async () => {
      const completed = await repo.findCompletedFormIdsByRespondent('user-1');
      expect(completed.size).toBe(0);
    });

    it('should return form IDs for SUBMITTED and VALIDATED responses only', async () => {
      await repo.recordResponse({
        formId: 'form-1',
        formVersionId: 'ver-1',
        respondentId: 'user-1',
        status: 'SUBMITTED',
      });
      await repo.recordResponse({
        formId: 'form-2',
        formVersionId: 'ver-1',
        respondentId: 'user-1',
        status: 'VALIDATED',
      });
      await repo.recordResponse({
        formId: 'form-3',
        formVersionId: 'ver-1',
        respondentId: 'user-1',
        status: 'IN_PROGRESS',
      });
      await repo.recordResponse({
        formId: 'form-4',
        formVersionId: 'ver-1',
        respondentId: 'user-2',
        status: 'SUBMITTED',
      });

      const completed = await repo.findCompletedFormIdsByRespondent('user-1');
      expect(completed.has('form-1')).toBe(true);
      expect(completed.has('form-2')).toBe(true);
      expect(completed.has('form-3')).toBe(false);
      expect(completed.has('form-4')).toBe(false);
      expect(completed.size).toBe(2);
    });

    it('should return completed counts by form IDs', async () => {
      await repo.recordResponse({
        formId: 'form-1',
        formVersionId: 'ver-1',
        respondentId: 'user-1',
        status: 'SUBMITTED',
      });
      await repo.recordResponse({
        formId: 'form-1',
        formVersionId: 'ver-1',
        respondentId: 'user-2',
        status: 'VALIDATED',
      });
      await repo.recordResponse({
        formId: 'form-1',
        formVersionId: 'ver-1',
        respondentId: 'user-3',
        status: 'REJECTED',
      });
      await repo.recordResponse({
        formId: 'form-2',
        formVersionId: 'ver-1',
        respondentId: 'user-4',
        status: 'SUBMITTED',
      });

      const counts = await repo.getCompletedCountsByFormIds([
        'form-1',
        'form-2',
        'form-3',
      ]);
      expect(counts.get('form-1')).toBe(2);
      expect(counts.get('form-2')).toBe(1);
      expect(counts.get('form-3') ?? 0).toBe(0);
    });
  });

  describe('PrismaSurveyResponseRepository', () => {
    let mockPrisma: any;
    let repo: PrismaSurveyResponseRepository;

    beforeEach(() => {
      mockPrisma = {
        response: {
          findMany: jest.fn(),
          groupBy: jest.fn(),
          create: jest.fn(),
        },
        surveyAttempt: {
          findMany: jest.fn().mockResolvedValue([]),
          groupBy: jest.fn().mockResolvedValue([]),
        },
      };
      repo = new PrismaSurveyResponseRepository(mockPrisma as PrismaService);
    });

    it('should query prisma for completed responses by respondent', async () => {
      mockPrisma.response.findMany.mockResolvedValue([
        { formId: 'form-1' },
        { formId: 'form-2' },
      ]);

      const result = await repo.findCompletedFormIdsByRespondent('user-123');

      expect(mockPrisma.response.findMany).toHaveBeenCalledWith({
        where: {
          respondentId: 'user-123',
          status: { in: ['SUBMITTED', 'VALIDATED'] },
        },
        select: { formId: true },
      });
      expect(result.size).toBe(2);
      expect(result.has('form-1')).toBe(true);
      expect(result.has('form-2')).toBe(true);
    });

    it('also treats COMPLETED attempts (External completions, disputed Responses) as completed (review P3)', async () => {
      mockPrisma.response.findMany.mockResolvedValue([{ formId: 'form-1' }]);
      mockPrisma.surveyAttempt.findMany.mockResolvedValue([
        { surveyId: 'form-1' },
        { surveyId: 'form-external' },
      ]);

      const result = await repo.findCompletedFormIdsByRespondent('user-123');

      expect(mockPrisma.surveyAttempt.findMany).toHaveBeenCalledWith({
        where: { respondentId: 'user-123', status: 'COMPLETED' },
        select: { surveyId: true },
      });
      expect([...result].sort()).toEqual(['form-1', 'form-external']);
    });

    it('should query prisma groupBy for completed counts', async () => {
      mockPrisma.response.groupBy.mockResolvedValue([
        { formId: 'form-1', _count: { _all: 5 } },
        { formId: 'form-2', _count: { _all: 3 } },
      ]);

      const counts = await repo.getCompletedCountsByFormIds([
        'form-1',
        'form-2',
      ]);

      expect(mockPrisma.response.groupBy).toHaveBeenCalledWith({
        by: ['formId'],
        where: {
          formId: { in: ['form-1', 'form-2'] },
          status: { in: ['SUBMITTED', 'VALIDATED'] },
        },
        _count: { _all: true },
      });
      expect(counts.get('form-1')).toBe(5);
      expect(counts.get('form-2')).toBe(3);
    });

    it('adds COMPLETED attempts without a Response (External completions) to the counts (review P3)', async () => {
      mockPrisma.response.groupBy.mockResolvedValue([
        { formId: 'form-1', _count: { _all: 2 } },
      ]);
      mockPrisma.surveyAttempt.groupBy.mockResolvedValue([
        { surveyId: 'form-1', _count: { _all: 1 } },
        { surveyId: 'form-external', _count: { _all: 4 } },
      ]);

      const counts = await repo.getCompletedCountsByFormIds([
        'form-1',
        'form-external',
        'form-empty',
      ]);

      expect(mockPrisma.surveyAttempt.groupBy).toHaveBeenCalledWith({
        by: ['surveyId'],
        where: {
          surveyId: { in: ['form-1', 'form-external', 'form-empty'] },
          status: 'COMPLETED',
          response: null,
        },
        _count: { _all: true },
      });
      expect(counts.get('form-1')).toBe(3);
      expect(counts.get('form-external')).toBe(4);
      expect(counts.get('form-empty')).toBe(0);
    });

    it('should return empty map without querying prisma when formIds is empty', async () => {
      const counts = await repo.getCompletedCountsByFormIds([]);
      expect(counts.size).toBe(0);
      expect(mockPrisma.response.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('createGuestResponseWithinQuota (Bug 3.3)', () => {
    const formId = '11111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const cutoffDate = new Date(now - 30 * 60 * 1000);
    const params = {
      formId,
      formVersionId: '22222222-2222-4222-8222-222222222222',
      answers: { q1: 'guest' },
      ipAddress: '203.0.113.1',
      cutoffDate,
    };

    interface Scenario {
      form: {
        status: string;
        type: string;
        expectedCompletions: number;
      } | null;
      completedResponses: number;
      externalCompletions: number;
      activeAttempts: number;
    }

    function prismaHarness(scenario: Scenario) {
      const log: string[] = [];
      const tx: any = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
          log.push(`sql:${strings.join('?').replace(/\s+/g, ' ').trim()}`);
          return scenario.form
            ? [
                {
                  status: scenario.form.status,
                  type: scenario.form.type,
                  expected_completions: scenario.form.expectedCompletions,
                },
              ]
            : [];
        }),
        response: {
          groupBy: jest.fn(async () => {
            log.push('response.groupBy');
            return scenario.completedResponses
              ? [{ formId, _count: { _all: scenario.completedResponses } }]
              : [];
          }),
          create: jest.fn(async ({ data }: any) => {
            log.push('response.create');
            return { id: 'resp-1', ...data };
          }),
        },
        surveyAttempt: {
          groupBy: jest.fn(async () =>
            scenario.externalCompletions
              ? [
                  {
                    surveyId: formId,
                    _count: { _all: scenario.externalCompletions },
                  },
                ]
              : [],
          ),
          count: jest.fn(async () => {
            log.push('surveyAttempt.count');
            return scenario.activeAttempts;
          }),
        },
      };
      const prisma: any = {
        $transaction: jest.fn(async (work: (client: unknown) => unknown) =>
          work(tx),
        ),
        response: { create: jest.fn() },
      };
      return {
        log,
        tx,
        prisma,
        repo: new PrismaSurveyResponseRepository(prisma as PrismaService),
      };
    }

    function inMemoryRepo(scenario: Scenario) {
      const repo = new InMemorySurveyResponseRepository();
      if (scenario.form) repo.registerForm({ id: formId, ...scenario.form });
      for (let i = 0; i < scenario.completedResponses; i++) {
        void repo.recordResponse({
          formId,
          respondentId: `user-${i}`,
          status: 'SUBMITTED',
        });
      }
      for (let i = 0; i < scenario.externalCompletions; i++) {
        repo.recordExternalCompletion(formId, `ext-${i}`);
      }
      for (let i = 0; i < scenario.activeAttempts; i++) {
        repo.recordActiveAttempt(formId, new Date(now));
      }
      return repo;
    }

    const open = {
      status: 'PUBLISHED',
      type: 'INTERNAL',
      expectedCompletions: 3,
    };
    const scenarios: Array<[string, Scenario, string]> = [
      [
        'room left',
        {
          form: open,
          completedResponses: 1,
          externalCompletions: 0,
          activeAttempts: 1,
        },
        'CREATED',
      ],
      [
        'completions + active reservations reach the quota',
        {
          form: open,
          completedResponses: 1,
          externalCompletions: 1,
          activeAttempts: 1,
        },
        'QUOTA_FULL',
      ],
      [
        'completions alone reach the quota',
        {
          form: open,
          completedResponses: 3,
          externalCompletions: 0,
          activeAttempts: 0,
        },
        'QUOTA_FULL',
      ],
      [
        'the form is CLOSED',
        {
          form: { ...open, status: 'CLOSED' },
          completedResponses: 0,
          externalCompletions: 0,
          activeAttempts: 0,
        },
        'NOT_OPEN',
      ],
      [
        'the form is EXTERNAL',
        {
          form: { ...open, type: 'EXTERNAL' },
          completedResponses: 0,
          externalCompletions: 0,
          activeAttempts: 0,
        },
        'NOT_OPEN',
      ],
      [
        'the form does not exist',
        {
          form: null,
          completedResponses: 0,
          externalCompletions: 0,
          activeAttempts: 0,
        },
        'NOT_OPEN',
      ],
    ];

    it.each(scenarios)(
      'Prisma and InMemory agree when %s',
      async (_label, scenario, expected) => {
        const prisma =
          await prismaHarness(scenario).repo.createGuestResponseWithinQuota(
            params,
          );
        const memory =
          await inMemoryRepo(scenario).createGuestResponseWithinQuota(params);

        expect(prisma.outcome).toBe(expected);
        expect(memory.outcome).toBe(expected);
      },
    );

    it('Prisma: takes the form row lock first, counts, then inserts a SUBMITTED guest response', async () => {
      const { log, tx, repo } = prismaHarness({
        form: open,
        completedResponses: 0,
        externalCompletions: 0,
        activeAttempts: 0,
      });

      const result = await repo.createGuestResponseWithinQuota(params);

      expect(result.outcome).toBe('CREATED');
      expect(log[0]).toMatch(
        /SELECT status, type, expected_completions FROM forms WHERE id = \? ?::uuid FOR NO KEY UPDATE/,
      );
      expect(tx.$queryRaw.mock.calls[0][1]).toBe(formId);
      expect(log.indexOf('response.create')).toBeGreaterThan(
        log.indexOf('surveyAttempt.count'),
      );
      expect(log.indexOf('response.create')).toBeGreaterThan(
        log.indexOf('response.groupBy'),
      );
      expect(tx.surveyAttempt.count).toHaveBeenCalledWith({
        where: {
          surveyId: formId,
          status: 'IN_PROGRESS',
          startedAt: { gte: cutoffDate },
        },
      });
      expect(tx.response.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          formId,
          formVersionId: params.formVersionId,
          respondentId: null,
          status: 'SUBMITTED',
          isGuest: true,
          answersJson: params.answers,
          ipAddress: params.ipAddress,
        }),
      });
    });

    it('Prisma: writes nothing when the quota is full or the form is not open', async () => {
      for (const scenario of [
        {
          form: open,
          completedResponses: 3,
          externalCompletions: 0,
          activeAttempts: 0,
        },
        {
          form: { ...open, status: 'CLOSED' },
          completedResponses: 0,
          externalCompletions: 0,
          activeAttempts: 0,
        },
      ]) {
        const { tx, prisma, repo } = prismaHarness(scenario);
        await repo.createGuestResponseWithinQuota(params);
        expect(tx.response.create).not.toHaveBeenCalled();
        expect(prisma.response.create).not.toHaveBeenCalled();
      }
    });

    describe('InMemory with the service stores injected (review F12)', () => {
      let formRepo: InMemoryFormRepository;
      let participationRepo: InMemoryParticipationRepository;
      let repo: InMemorySurveyResponseRepository;

      beforeEach(async () => {
        formRepo = new InMemoryFormRepository();
        participationRepo = new InMemoryParticipationRepository();
        repo = new InMemorySurveyResponseRepository({
          forms: formRepo,
          attempts: participationRepo,
        });
        const created = new Date(now);
        await formRepo.create(
          new FormEntity(
            formId,
            '33333333-3333-4333-8333-333333333333',
            'INTERNAL',
            'PUBLISHED',
            'Shared Store Survey',
            null,
            10,
            2,
            created,
            created,
          ),
          new FormVersionEntity(
            params.formVersionId,
            formId,
            1,
            { blocks: [] } as never,
            null,
            true,
            null,
            null,
            created,
            created,
          ),
        );
      });

      it('returns NOT_OPEN once the form is closed through the form repository', async () => {
        const stored = (await formRepo.findById(formId))!;
        await formRepo.update(
          stored.form.close('OWNER', new Date(now)),
          stored.currentVersion,
        );

        await expect(
          repo.createGuestResponseWithinQuota(params),
        ).resolves.toEqual({ outcome: 'NOT_OPEN' });
      });

      it('counts a paid IN_PROGRESS attempt started through participation toward the quota', async () => {
        const reserved = await participationRepo.reserveAttempt({
          attemptId: '44444444-4444-4444-8444-444444444444',
          formId,
          formVersionId: params.formVersionId,
          respondentId: '55555555-5555-4555-8555-555555555555',
          isGuest: false,
          formType: 'INTERNAL',
          ipAddress: '203.0.113.9',
          startedAt: new Date(now),
          expectedCompletions: 2,
          cutoffDate,
        });
        expect(reserved.outcome).toBe('CREATED');

        // Quota 2: the paid reservation plus one guest fill it.
        await expect(
          repo.createGuestResponseWithinQuota(params),
        ).resolves.toMatchObject({ outcome: 'CREATED' });
        await expect(
          repo.createGuestResponseWithinQuota(params),
        ).resolves.toEqual({ outcome: 'QUOTA_FULL' });
      });

      it('ignores the registerForm / recordActiveAttempt test maps', async () => {
        repo.registerForm({ id: formId, ...open, status: 'CLOSED' });
        repo.recordActiveAttempt(formId, new Date(now));
        repo.recordActiveAttempt(formId, new Date(now));

        await expect(
          repo.createGuestResponseWithinQuota(params),
        ).resolves.toMatchObject({ outcome: 'CREATED' });
      });
    });

    it('InMemory: ignores expired reservations and counts the new guest response as a completion', async () => {
      const repo = new InMemorySurveyResponseRepository();
      repo.registerForm({ id: formId, ...open, expectedCompletions: 1 });
      repo.recordActiveAttempt(formId, new Date(cutoffDate.getTime() - 1));

      await expect(
        repo.createGuestResponseWithinQuota(params),
      ).resolves.toMatchObject({ outcome: 'CREATED' });
      expect(
        (await repo.getCompletedCountsByFormIds([formId])).get(formId),
      ).toBe(1);
      await expect(
        repo.createGuestResponseWithinQuota(params),
      ).resolves.toEqual({ outcome: 'QUOTA_FULL' });
    });
  });
});
