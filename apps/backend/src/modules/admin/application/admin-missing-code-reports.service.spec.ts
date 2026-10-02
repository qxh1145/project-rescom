import { missingCodeReportPageSchema } from '@rescom/schemas';
import { AdminMissingCodeReportsService } from './admin-missing-code-reports.service';
import { InMemoryMissingCodeReportStats } from '../../participation/infrastructure/in-memory-missing-code-report-stats';

const FORM = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, n));
const id = (n: number) => `33333333-3333-4333-8333-33333333333${n}`;

describe('AdminMissingCodeReportsService', () => {
  const stats = new InMemoryMissingCodeReportStats();
  const service = new AdminMissingCodeReportsService({
    reports: stats,
    formTitles: {
      findTitles: async () => ({
        byFormId: new Map([[FORM, 'Khảo sát A']]),
        byFormVersionId: new Map(),
      }),
    },
    profiles: {
      findDisplayLabels: async () => new Map([[USER, ' Minh ']]),
    },
  });

  beforeEach(() => {
    stats.unresolved = 3;
    stats.reports = [1, 2, 3].map((n) => ({
      attemptId: id(n),
      surveyId: FORM,
      respondentId: USER,
      reason: n === 1 ? null : 'Không thấy mã',
      reportedAt: at(n),
      attemptStatus: 'IN_PROGRESS',
    }));
  });

  it('pages newest first with a keyset cursor and labels', async () => {
    const first = missingCodeReportPageSchema.parse(
      await service.list({ limit: 2 }),
    );
    expect(first.items.map((r) => r.attemptId)).toEqual([id(3), id(2)]);
    expect(first.total).toBe(3);
    expect(first.items[0]).toMatchObject({
      survey: { id: FORM, title: 'Khảo sát A' },
      respondent: { id: USER, displayName: 'Minh' },
      reason: 'Không thấy mã',
    });
    expect(first.nextCursor).not.toBeNull();

    const second = await service.list({
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((r) => r.attemptId)).toEqual([id(1)]);
    expect(second.items[0].reason).toBeNull();
    expect(second.nextCursor).toBeNull();
  });
});
