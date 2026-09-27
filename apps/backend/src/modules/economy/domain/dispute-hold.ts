import { LedgerJournalEntity } from './ledger-journal.entity';

/**
 * Keys and description format of External dispute holds (FR-24, BE-5). The
 * hold journal is the only ledger record linking a dispute case to its
 * External attempt, so its description carries the attempt id in a fixed
 * form. `attemptIdFromDisputeHold` is the one matcher of that form; the
 * Prisma maturity scan mirrors its pattern in SQL.
 */
export const DISPUTE_HOLD_KEY_PREFIX = 'external-dispute:';
export const DISPUTE_RESOLUTION_KEY_PREFIX = 'dispute-resolution:';

/** Idempotency key of the dispute hold of case `caseId`. */
export function disputeHoldKey(caseId: string): string {
  return `${DISPUTE_HOLD_KEY_PREFIX}${caseId}`;
}

/** Idempotency key of the resolution of dispute case `caseId`. */
export function disputeResolutionKey(
  caseId: string,
  action: 'release' | 'refund',
): string {
  return `${DISPUTE_RESOLUTION_KEY_PREFIX}${caseId}:${action}`;
}

/** Description fragment that names the attempt of a hold. */
export function disputeHoldAttemptMarker(attemptId: string): string {
  return `external attempt: ${attemptId} (Case `;
}

/** Description of the hold of case `caseId` on External attempt `attemptId`. */
export function disputeHoldDescription(
  attemptId: string,
  caseId: string,
): string {
  return `Dispute hold placed for ${disputeHoldAttemptMarker(attemptId)}${caseId})`;
}

/**
 * True when a hold description built from these references parses back to
 * them in JavaScript and PostgreSQL alike: the attempt id is non-empty and
 * holds no whitespace, separator or control character, and the case id is
 * non-empty and holds no control character or line/paragraph separator.
 */
export function isValidDisputeHoldReference(
  attemptId: string,
  caseId: string,
): boolean {
  return (
    attemptId.length > 0 &&
    !/[\s\p{Z}\p{Cc}]/u.test(attemptId) &&
    caseId.length > 0 &&
    !/[\p{Cc}\u2028\u2029]/u.test(caseId)
  );
}

/**
 * Attempt id recorded in an `external-dispute:{caseId}` hold, or null. The
 * case id `[\s\S]*` matches like PostgreSQL's `.`, and the SQL twin is
 * `'external attempt: ([^[:space:]]+) [(]Case (.*)[)]$'`.
 */
export function attemptIdFromDisputeHold(
  hold: LedgerJournalEntity,
): string | null {
  const caseId = hold.idempotencyKey.slice(DISPUTE_HOLD_KEY_PREFIX.length);
  const match = /external attempt: (\S+) [(]Case ([\s\S]*)[)]$/.exec(
    hold.description ?? '',
  );
  return match && match[2] === caseId ? match[1] : null;
}
