/**
 * Participation-owned read side of the append-only `fraud_logs` evidence
 * (mock-off plan 4.2, AD-16): the Admin FraudLog view and the overview's
 * flagged accounts read it through this port only. Every method is bounded
 * (`limit`) or aggregates on the `(created_at, id)` / `(user_id, created_at)`
 * indexes.
 *
 * `kind` is the displayed kind of `@rescom/schemas` `fraudLogKindOf`: the
 * backend type, with a wrong completion code (`SECURITY_VIOLATION`,
 * `details.action = COMPLETION_CODE_VERIFICATION_FAILED`) as
 * `COMPLETION_CODE`.
 */
export const FRAUD_LOG_READ_PORT = Symbol('FRAUD_LOG_READ_PORT');

export interface FraudLogReadFilter {
  /** undefined = every account; an empty list matches nothing. */
  userIds?: readonly string[];
  /** Entries created at or after this instant. */
  since?: Date;
  kind?: string;
}

export interface FraudLogRecord {
  id: string;
  userId: string;
  type: string;
  details: unknown;
  /** ISO instant (UTC, millisecond precision). */
  createdAt: string;
  /** Form the evidence is about: `details.formId`, else the attempt's survey. */
  surveyId: string | null;
  /** `details.formVersionId`, when the evidence names one. */
  formVersionId: string | null;
}

export interface FraudLogAccountCount {
  userId: string;
  count: number;
}

export interface FraudLogFlaggedAccount extends FraudLogAccountCount {
  /** Distinct displayed kinds (unordered). */
  kinds: string[];
}

/**
 * `cap`: the aggregate reads at most the newest `cap` matching entries (a
 * backward walk of the `(created_at, id)` index), never the whole table.
 */
export interface FraudLogReadPort {
  /** Newest first (ties by id descending), strictly after `before` when given. */
  list(
    filter: FraudLogReadFilter,
    before: { createdAt: string; id: string } | null,
    limit: number,
  ): Promise<FraudLogRecord[]>;
  /** Matching entries among the newest `cap` (so at most `cap`). */
  countCapped(filter: FraudLogReadFilter, cap: number): Promise<number>;
  /** Entries per account among the newest `cap`, most first (ties by id), at most `limit` accounts. */
  countByAccount(
    filter: FraudLogReadFilter,
    limit: number,
    cap: number,
  ): Promise<FraudLogAccountCount[]>;
  /** Distinct accounts among the newest `cap`, latest entry first, at most `limit`. */
  candidateUserIds(
    filter: FraudLogReadFilter,
    limit: number,
    cap: number,
  ): Promise<string[]>;
  /** Accounts with entries since `since`, most first (ties by id), with their kinds. */
  topAccountsSince(
    since: Date,
    limit: number,
  ): Promise<FraudLogFlaggedAccount[]>;
}
