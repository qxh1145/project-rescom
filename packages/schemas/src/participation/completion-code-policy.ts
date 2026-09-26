import { z } from 'zod';

/**
 * Code-review decision E5-D1 (2026-09-26, option B) — the versioned
 * completion-code failure policy of FR-22.
 *
 * PROVISIONAL: PRD Open Question 14 (attempt limit, lock duration, recovery
 * flow, audit behavior) is not approved yet. These are the accepted review
 * defaults, not approved launch values; a change of any value needs a new
 * policy version.
 *
 * - 3 wrong codes lock the attempt (`LOCKED`, 409 `ATTEMPT_LOCKED`).
 * - 6 wrong codes per account and FormVersion, summed across all of that
 *   account's attempts on the version, refuse further attempts and code
 *   verifications on that version (409 `COMPLETION_CODE_LIMIT_REACHED`).
 * - No automatic reset. An Admin recovers the account for that version (an
 *   audited reset); a new FormVersion (new code) starts a fresh count.
 * - Counters are server-owned (`survey_attempts.failed_code_verifications`,
 *   Epic 5 review P2), never client-supplied.
 */
export const COMPLETION_CODE_POLICY_VERSION = 'completion-code-policy-v1';

export interface CompletionCodePolicy {
  /** Wrong codes that lock one attempt. */
  maxFailuresPerAttempt: number;
  /** Wrong codes per account and FormVersion across all attempts. */
  maxFailuresPerAccountVersion: number;
}

export const COMPLETION_CODE_POLICY: Readonly<CompletionCodePolicy> =
  Object.freeze({
    maxFailuresPerAttempt: 3,
    maxFailuresPerAccountVersion: 6,
  });

export const COMPLETION_CODE_LIMIT_REACHED_CODE =
  'COMPLETION_CODE_LIMIT_REACHED';

function nonNegativeWhole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Code tries left for the respondent: the smaller of the attempt's budget and
 * the account+version budget, clamped to `0..maxFailuresPerAttempt`.
 */
export function remainingCompletionCodeTries(input: {
  attemptFailures: number;
  accountFailures: number;
  policy?: CompletionCodePolicy;
}): number {
  const policy = input.policy ?? COMPLETION_CODE_POLICY;
  const attemptLeft =
    policy.maxFailuresPerAttempt - nonNegativeWhole(input.attemptFailures);
  const accountLeft =
    policy.maxFailuresPerAccountVersion -
    nonNegativeWhole(input.accountFailures);
  return Math.min(
    policy.maxFailuresPerAttempt,
    Math.max(0, Math.min(attemptLeft, accountLeft)),
  );
}

/** True once the account used every try on the FormVersion. */
export function isCompletionCodeLimitReached(
  accountFailures: number,
  policy: CompletionCodePolicy = COMPLETION_CODE_POLICY,
): boolean {
  return nonNegativeWhole(accountFailures) >= policy.maxFailuresPerAccountVersion;
}

/** `error.details` of `409 COMPLETION_CODE_LIMIT_REACHED`. */
export const completionCodeLimitDetailsSchema = z
  .object({
    formVersionId: z.string().min(1),
    failedVerifications: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    policyVersion: z.string().min(1),
  })
  .strict();
export type CompletionCodeLimitDetails = z.infer<
  typeof completionCodeLimitDetailsSchema
>;

/**
 * Admin recovery (decision E5-D1): `POST /admin/completion-code-limits/reset`
 * forgives the account's counted wrong codes on one FormVersion. The attempts
 * and their FraudLog evidence stay untouched; the reset itself is recorded
 * (who, when, why, how many).
 */
export const completionCodeLimitResetRequestSchema = z
  .object({
    respondentId: z.string().uuid(),
    formVersionId: z.string().uuid(),
    reason: z
      .string()
      .trim()
      .min(5, 'Reason must be at least 5 characters')
      .max(1000, 'Reason cannot exceed 1000 characters'),
  })
  .strict();
export type CompletionCodeLimitResetRequest = z.infer<
  typeof completionCodeLimitResetRequestSchema
>;

export const completionCodeLimitResetResultSchema = z
  .object({
    respondentId: z.string().uuid(),
    formVersionId: z.string().uuid(),
    /** Wrong codes forgiven by this reset (0 = nothing was counted). */
    failuresForgiven: z.number().int().nonnegative(),
    /** Counted wrong codes after the reset (always 0). */
    failedVerifications: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    /** null when nothing needed resetting (no row written). */
    resetAt: z.string().datetime().nullable(),
    policyVersion: z.string().min(1),
  })
  .strict();
export type CompletionCodeLimitResetResultDto = z.infer<
  typeof completionCodeLimitResetResultSchema
>;
