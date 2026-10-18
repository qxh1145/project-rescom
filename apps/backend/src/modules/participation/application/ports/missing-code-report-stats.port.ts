/**
 * Participation-owned counter of open FR-23 missing-completion-code reports
 * for the Admin overview (`openIssues.missingCodeReports`, AD-16).
 *
 * Open means the attempt has `missing_code_reported_at` set,
 * `missing_code_resolved_at` is NULL, it is not `COMPLETED` (the respondent
 * was not rewarded through a verified code or admin resolution), and the Admin
 * has not reset the respondent's completion-code limit for that form version
 * (`completion_code_limit_resets`) at or after the report.
 */
export const MISSING_CODE_REPORT_STATS_PORT = Symbol(
  'MISSING_CODE_REPORT_STATS_PORT',
);

export interface UnresolvedMissingCodeReport {
  attemptId: string;
  surveyId: string;
  formVersionId: string;
  respondentId: string | null;
  reason: string | null;
  reportedAt: Date;
  attemptStatus: string;
  failedCodeVerifications: number;
  attemptCancelled: boolean;
  respondentCompletedForm: boolean;
}

export interface MissingCodeReportStatsPort {
  countUnresolved(): Promise<number>;
  /** Unresolved reports, newest first (ties by attempt id desc), keyset after `before`. */
  listUnresolved(
    before: { createdAt: string; id: string } | null,
    limit: number,
  ): Promise<UnresolvedMissingCodeReport[]>;
}
