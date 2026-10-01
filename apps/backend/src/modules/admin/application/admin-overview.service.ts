import {
  ADMIN_OVERVIEW_FLAGGED_LIMIT,
  AdminOverview,
  AdminQueueCounts,
  AdminTodoItem,
  FRAUD_REPEAT_THRESHOLD,
  FRAUD_REPEAT_WINDOW_DAYS,
  FlaggedAccount,
} from '@rescom/schemas';
import type { ModerationQueueStatsPort } from '../../forms/application/ports/moderation-queue-stats.port';
import type { AdminEconomyStatsPort } from '../../economy/application/ports/admin-economy-stats.port';
import type { FraudLogReadPort } from '../../participation/application/ports/fraud-log-read.port';
import type { MissingCodeReportStatsPort } from '../../participation/application/ports/missing-code-report-stats.port';
import type { AdminUserDirectoryPort } from '../../users/application/ports/admin-user-directory.port';
import type { Clock } from '../../../common/time/clock';

const DAY_MS = 86_400_000;

export interface AdminOverviewDependencies {
  queueStats: ModerationQueueStatsPort;
  economyStats: Pick<
    AdminEconomyStatsPort,
    'pendingTopUpSummary' | 'oldestPendingTopUp' | 'balanceTotals'
  >;
  fraudLogs: Pick<FraudLogReadPort, 'topAccountsSince'>;
  missingCodeReports: MissingCodeReportStatsPort;
  directory: Pick<AdminUserDirectoryPort, 'findLabels'>;
  /** The shared `CLOCK`; the system time when absent. */
  clock?: Clock;
}

/** Shown when a stored survey title is blank (the contract requires `min(1)`). */
export const UNTITLED_SURVEY = '(Không tiêu đề)';

/** "7F3A": the first four hex digits of an id (the admin short code without `#`). */
export function shortReferenceOf(id: string): string {
  return id.replace(/-/g, '').slice(0, 4).toUpperCase();
}

/**
 * Admin console aggregates (Story IR.4b part C, mock-off plan 4.1). Reads
 * other contexts only through the ports they own (AD-16) and runs a fixed
 * number of bounded queries per request, whatever the data size: at most 8
 * for the overview (7 aggregates in parallel, then one label query).
 *
 * Deliberate override of IR.4b AC C3/C4 (decision Q1): disputes and quality
 * reviews stay on MSW, so `disputes` and `quality` are 0 here (instead of
 * omitted) and no `DISPUTE` / `MISSING_CODE` to-do item is emitted.
 * `openIssues.missingCodeReports` is real (see `@rescom/schemas`
 * `admin-overview.schema.ts`).
 */
export class AdminOverviewService {
  private readonly now: () => Date;

  constructor(private readonly deps: AdminOverviewDependencies) {
    this.now = () => deps.clock?.now() ?? new Date();
  }

  async getQueueCounts(): Promise<AdminQueueCounts> {
    const [forms, topUps] = await Promise.all([
      this.deps.queueStats.countByStatus(),
      this.deps.economyStats.pendingTopUpSummary(),
    ]);
    return {
      surveys: forms.queued,
      topUps: topUps.count,
      disputes: 0,
      quality: 0,
    };
  }

  async getOverview(): Promise<AdminOverview> {
    const since = new Date(
      this.now().getTime() - FRAUD_REPEAT_WINDOW_DAYS * DAY_MS,
    );
    const [
      forms,
      oldestForm,
      topUps,
      oldestTopUp,
      balances,
      flagged,
      missingCodeReports,
    ] = await Promise.all([
      this.deps.queueStats.countByStatus(),
      this.deps.queueStats.oldestQueued(),
      this.deps.economyStats.pendingTopUpSummary(),
      this.deps.economyStats.oldestPendingTopUp(),
      this.deps.economyStats.balanceTotals(),
      this.deps.fraudLogs.topAccountsSince(since, ADMIN_OVERVIEW_FLAGGED_LIMIT),
      this.deps.missingCodeReports.countUnresolved(),
    ]);

    const labels = await this.labelsOf(
      [oldestForm?.publisherId, oldestTopUp?.userId].filter(
        (id): id is string => Boolean(id),
      ),
    );

    const todo: AdminTodoItem[] = [];
    if (oldestForm) {
      todo.push({
        kind: 'SURVEY_REVIEW',
        id: oldestForm.formId,
        createdAt: oldestForm.submittedAt.toISOString(),
        moreCount: Math.max(0, forms.queued - 1),
        priority: false,
        surveyTitle: oldestForm.title.trim() || UNTITLED_SURVEY,
        publisherName: labels.get(oldestForm.publisherId)!,
        surveyType: oldestForm.type,
      });
    }
    if (oldestTopUp) {
      todo.push({
        kind: 'TOP_UP',
        id: oldestTopUp.id,
        createdAt: oldestTopUp.createdAt.toISOString(),
        moreCount: Math.max(0, topUps.count - 1),
        priority: false,
        points: oldestTopUp.amount,
        amountVnd: oldestTopUp.amountVnd,
        requesterName: labels.get(oldestTopUp.userId)!,
        transferReference: oldestTopUp.transferReference,
      });
    }

    return {
      pendingSurveys: { count: forms.queued },
      pendingTopUps: topUps,
      openIssues: { disputes: 0, missingCodeReports },
      escrow: { points: balances.escrow, runningSurveys: forms.published },
      todo,
      flaggedAccounts: flagged.map((account): FlaggedAccount => ({
        userId: account.userId,
        reference: shortReferenceOf(account.userId),
        violationCount: account.count,
        windowDays: FRAUD_REPEAT_WINDOW_DAYS,
        types: [...account.kinds].sort(),
        repeated: account.count >= FRAUD_REPEAT_THRESHOLD,
      })),
    };
  }

  /**
   * Admin label per user: display name, else e-mail, else the short code
   * (never empty: the contract requires `min(1)`). One query, at most two users.
   */
  private async labelsOf(
    userIds: readonly string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const labels = await this.deps.directory.findLabels(ids);
    return new Map(
      ids.map((id) => {
        const label = labels.get(id);
        return [
          id,
          label?.displayName?.trim() ||
            label?.email ||
            `#${shortReferenceOf(id)}`,
        ];
      }),
    );
  }
}
