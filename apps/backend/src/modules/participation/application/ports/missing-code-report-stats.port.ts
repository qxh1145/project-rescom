/**
 * Participation-owned counter of open FR-23 missing-completion-code reports
 * for the Admin overview (`openIssues.missingCodeReports`, AD-16).
 *
 * There is no resolution column, so "unresolved" is derived from existing
 * data: the attempt has `missing_code_reported_at` set, it is not
 * `COMPLETED` (the respondent was not rewarded through a verified code), and
 * the Admin has not reset the respondent's completion-code limit for that
 * form version (`completion_code_limit_resets`) at or after the report — the
 * recovery path an Admin uses after investigating a report.
 */
export const MISSING_CODE_REPORT_STATS_PORT = Symbol(
  'MISSING_CODE_REPORT_STATS_PORT',
);

export interface MissingCodeReportStatsPort {
  countUnresolved(): Promise<number>;
}
