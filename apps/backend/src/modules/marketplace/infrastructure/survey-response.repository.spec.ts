import { InMemorySurveyResponseRepository } from './in-memory-survey-response.repository';
import { PrismaSurveyResponseRepository } from './prisma-survey-response.repository';
import { PrismaService } from '../../../common/database/prisma.service';

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
});
