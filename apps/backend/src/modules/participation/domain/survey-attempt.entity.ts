import {
  COMPLETION_CODE_POLICY,
  remainingCompletionCodeTries,
} from '@rescom/schemas';

export type AttemptStatus =
  'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'LOCKED';

/**
 * FR-22 / `completion-code-policy-v1` (decision E5-D1, provisional pending
 * OQ14): wrong completion codes allowed per attempt before it is LOCKED.
 */
export const MAX_COMPLETION_CODE_FAILURES =
  COMPLETION_CODE_POLICY.maxFailuresPerAttempt;

/**
 * Decision E5-D1: wrong codes allowed per account and FormVersion, summed
 * across attempts; then further attempts on that version are refused until
 * an Admin resets the count.
 */
export const MAX_COMPLETION_CODE_FAILURES_PER_ACCOUNT_VERSION =
  COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion;

/**
 * Server-owned completion-code security state of an attempt (Epic 5 review
 * P2). It never comes from `clientContext`, which the client controls.
 */
export interface AttemptCodeVerificationState {
  failedCount: number;
  lastFailedAt: Date | null;
  missingCodeReportedAt: Date | null;
  missingCodeReason: string | null;
}

export const EMPTY_CODE_VERIFICATION_STATE: AttemptCodeVerificationState =
  Object.freeze({
    failedCount: 0,
    lastFailedAt: null,
    missingCodeReportedAt: null,
    missingCodeReason: null,
  });

export class SurveyAttemptEntity {
  constructor(
    public readonly id: string,
    public readonly surveyId: string,
    public readonly formVersionId: string,
    public readonly respondentId: string | null,
    public readonly status: AttemptStatus,
    public readonly isGuest: boolean,
    public readonly startedAt: Date,
    public readonly submittedAt: Date | null,
    /** Opaque client diagnostics; server logic never reads it. */
    public readonly clientContext: Record<string, unknown> | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly codeVerification: AttemptCodeVerificationState = EMPTY_CODE_VERIFICATION_STATE,
  ) {}

  isActive(cutoffDate: Date): boolean {
    return this.status === 'IN_PROGRESS' && this.startedAt >= cutoffDate;
  }

  isExpired(cutoffDate: Date): boolean {
    return this.status === 'IN_PROGRESS' && this.startedAt < cutoffDate;
  }
}

/**
 * Tries left before the lock, clamped to 0..MAX (Epic 5 review P2). With the
 * account's summed wrong codes on the FormVersion (decision E5-D1), the
 * smaller of both budgets.
 */
export function remainingCodeAttempts(
  failedCount: number,
  accountFailedCount: number = failedCount,
): number {
  return remainingCompletionCodeTries({
    attemptFailures: failedCount,
    accountFailures: accountFailedCount,
  });
}
