import {
  ListMissingCodeReportsQuery,
  MissingCodeReport,
  MissingCodeReportPage,
  keysetCursorOf,
  parseKeysetCursor,
} from '@rescom/schemas';
import type { MissingCodeReportStatsPort } from '../../participation/application/ports/missing-code-report-stats.port';
import type { FormTitleLookupPort } from '../../forms/application/ports/form-title-lookup.port';
import type { UserProfileRepositoryPort } from '../../users/application/ports/user-profile.repository.port';

export interface AdminMissingCodeReportsDependencies {
  reports: MissingCodeReportStatsPort;
  formTitles: FormTitleLookupPort;
  profiles: Pick<UserProfileRepositoryPort, 'findDisplayLabels'>;
}

/**
 * Admin · unresolved FR-23 missing-code reports, read only: Participation
 * owns the reports, Forms the titles, Identity the display names (AD-16).
 */
export class AdminMissingCodeReportsService {
  constructor(private readonly deps: AdminMissingCodeReportsDependencies) {}

  async list(
    query: ListMissingCodeReportsQuery,
  ): Promise<MissingCodeReportPage> {
    const before = query.cursor ? parseKeysetCursor(query.cursor) : null;
    const [rows, total] = await Promise.all([
      this.deps.reports.listUnresolved(before, query.limit + 1),
      this.deps.reports.countUnresolved(),
    ]);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];

    const formIds = [...new Set(page.map((row) => row.surveyId))];
    const userIds = [
      ...new Set(
        page.map((row) => row.respondentId).filter((id): id is string => !!id),
      ),
    ];
    const [summaries, names] = await Promise.all([
      formIds.length > 0
        ? this.deps.formTitles.findSummaries({ formIds })
        : Promise.resolve(new Map()),
      userIds.length > 0
        ? this.deps.profiles.findDisplayLabels(userIds)
        : Promise.resolve(new Map<string, string | null>()),
    ]);

    const items = page.map((row): MissingCodeReport => {
      const summary = summaries.get(row.surveyId);
      return {
        attemptId: row.attemptId,
        survey: summary ? { id: row.surveyId, title: summary.title } : null,
        respondent: row.respondentId
          ? {
              id: row.respondentId,
              displayName: names.get(row.respondentId)?.trim() || null,
            }
          : null,
        reason: row.reason,
        reportedAt: row.reportedAt.toISOString(),
        attemptStatus: row.attemptStatus as MissingCodeReport['attemptStatus'],
        formVersionId: row.formVersionId,
        rewardPerResponse: summary?.rewardPerResponse ?? 0,
        surveyOpen: summary?.status === 'PUBLISHED',
        failedCodeVerifications: row.failedCodeVerifications,
      };
    });
    return {
      items,
      total,
      nextCursor:
        rows.length > query.limit && last
          ? keysetCursorOf({ createdAt: last.reportedAt, id: last.attemptId })
          : null,
    };
  }
}
