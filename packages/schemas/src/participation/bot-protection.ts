import { z } from 'zod';
import { formBlockTypeEnum } from '../forms/form-blocks.schema';

/**
 * Story 8.2 — Automated Bot Protection (FR-28, FR-45, FR-46, NFR-4, AD-6).
 *
 * Single rule source shared by the backend and the frontend mock:
 * - Time Barrier: an Internal Form submission must take at least
 *   `answerable questions x 2` seconds (or the publisher-configured minimum,
 *   whichever is stricter), measured from the server-recorded attempt start.
 * - Rate Limit: a centrally versioned policy (not a per-user Admin setting).
 *   The completion limit is counted from PostgreSQL (authoritative); request
 *   bursts use an ephemeral counter store (in-process today, Redis when the
 *   deployment runs the `REDIS_SHARED` abuse-control profile).
 */

export const TIME_BARRIER_SECONDS_PER_QUESTION = 2;
export const TIME_BARRIER_POLICY_VERSION = 'time-barrier-v1';

/** External forms have no question count; keep the Story 5.5 default. */
export const DEFAULT_EXTERNAL_TIME_BARRIER_SECONDS = 15;

/**
 * Upper bound of a publisher minimum (the integrity metadata schema maximum,
 * 24 hours). Epic 8 review P11: a corrupt or legacy stored value above it is
 * clamped, so it can never overflow a Date (RangeError, 500).
 */
export const MAX_TIME_BARRIER_SECONDS = 86_400;

/**
 * The name of the default (provisional) values below. Decision E8-D4
 * (option B): a deployment that overrides any value must run under its own
 * explicit policy version (`PARTICIPATION_RATE_LIMIT_POLICY_VERSION`, required
 * in production), so rate-limit evidence is never mislabelled with this one.
 */
export const PARTICIPATION_RATE_LIMIT_POLICY_VERSION =
  'participation-rate-limit-v1';

/**
 * Shape of a policy version name (stamped on every 429 and FraudLog entry):
 * 1–64 characters, letters/digits first, then letters, digits, `.`, `_`,
 * `:` or `-`.
 */
export const PARTICIPATION_RATE_LIMIT_POLICY_VERSION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export interface ParticipationRateLimitPolicy {
  /** Max completed surveys (Internal + External) per user per rolling window. */
  completionLimit: number;
  completionWindowSeconds: number;
  /** Max attempt-start / submission / code-verification requests per user per action per window. */
  burstLimit: number;
  burstWindowSeconds: number;
  /**
   * The version name these values run under (decision E8-D4); stamped on
   * every 429 and FraudLog entry. Defaults to
   * `PARTICIPATION_RATE_LIMIT_POLICY_VERSION` (the provisional defaults).
   */
  policyVersion?: string;
}

/**
 * Provisional launch values (PRD Open Question 16 is still open): conservative
 * enough to stop scripted escrow draining without blocking normal students.
 */
export const DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY: Readonly<ParticipationRateLimitPolicy> =
  Object.freeze({
    completionLimit: 20,
    completionWindowSeconds: 3600,
    burstLimit: 10,
    burstWindowSeconds: 60,
  });

/** The version name to stamp on evidence produced under `policy`. */
export function resolveParticipationRateLimitPolicyVersion(
  policy: Pick<ParticipationRateLimitPolicy, 'policyVersion'>,
): string {
  return policy.policyVersion ?? PARTICIPATION_RATE_LIMIT_POLICY_VERSION;
}

/**
 * True when every limit equals the provisional defaults, i.e. the values may
 * carry the name `participation-rate-limit-v1` (decision E8-D4).
 */
export function hasDefaultParticipationRateLimitValues(
  policy: Omit<ParticipationRateLimitPolicy, 'policyVersion'>,
): boolean {
  const defaults = DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY;
  return (
    policy.completionLimit === defaults.completionLimit &&
    policy.completionWindowSeconds === defaults.completionWindowSeconds &&
    policy.burstLimit === defaults.burstLimit &&
    policy.burstWindowSeconds === defaults.burstWindowSeconds
  );
}

export const SUBMISSION_TOO_FAST_CODE = 'SUBMISSION_TOO_FAST';
export const PARTICIPATION_RATE_LIMITED_CODE = 'PARTICIPATION_RATE_LIMITED';

export const participationRateLimitScopeSchema = z.enum([
  'COMPLETIONS',
  'ATTEMPT_START',
  'INTERNAL_SUBMISSION',
  'COMPLETION_CODE',
]);
export type ParticipationRateLimitScope = z.infer<
  typeof participationRateLimitScopeSchema
>;

const ANSWERABLE_BLOCK_TYPES: ReadonlySet<string> = new Set(
  formBlockTypeEnum.options,
);

/**
 * Every current block type collects an answer. Static blocks that may be added
 * later (sections, descriptions, images) are not questions and never count.
 */
export function isAnswerableBlockType(type: unknown): boolean {
  return typeof type === 'string' && ANSWERABLE_BLOCK_TYPES.has(type);
}

export function countAnswerableQuestions(
  blocks: ReadonlyArray<{ type?: unknown }> | null | undefined,
): number {
  if (!Array.isArray(blocks)) return 0;
  return blocks.filter((block) => isAnswerableBlockType(block?.type)).length;
}

export interface TimeBarrierRequirement {
  requiredSeconds: number;
  questionCount: number;
  secondsPerQuestion: number;
  publisherMinimumSeconds: number;
  policyVersion: string;
}

function positiveWholeSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.ceil(value), MAX_TIME_BARRIER_SECONDS)
    : 0;
}

/**
 * Effective Internal Form barrier = max(answerable questions x 2 s,
 * publisher `metadata.minTimeBarrierSeconds`). Callers must pass the PINNED
 * FormVersion definition of the attempt.
 */
export function computeInternalTimeBarrier(
  definition:
    | {
        blocks?: ReadonlyArray<{ type?: unknown }> | null;
        metadata?: { minTimeBarrierSeconds?: number | null } | null;
      }
    | null
    | undefined,
): TimeBarrierRequirement {
  const questionCount = countAnswerableQuestions(definition?.blocks);
  const publisherMinimumSeconds = positiveWholeSeconds(
    definition?.metadata?.minTimeBarrierSeconds,
  );
  return {
    requiredSeconds: Math.max(
      questionCount * TIME_BARRIER_SECONDS_PER_QUESTION,
      publisherMinimumSeconds,
    ),
    questionCount,
    secondsPerQuestion: TIME_BARRIER_SECONDS_PER_QUESTION,
    publisherMinimumSeconds,
    policyVersion: TIME_BARRIER_POLICY_VERSION,
  };
}

export function resolveExternalTimeBarrierSeconds(
  metadata: { minTimeBarrierSeconds?: number | null } | null | undefined,
): number {
  return (
    positiveWholeSeconds(metadata?.minTimeBarrierSeconds) ||
    DEFAULT_EXTERNAL_TIME_BARRIER_SECONDS
  );
}

export interface TimeBarrierEvaluation {
  passed: boolean;
  elapsedMs: number;
  /** Whole seconds elapsed (floored). */
  elapsedSeconds: number;
  requiredSeconds: number;
  /** Whole seconds still to wait (rounded up); 0 once passed. */
  remainingSeconds: number;
  earliestSubmitAt: string;
}

function toEpochMs(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Server-authoritative check: `startedAt` must be the server-recorded attempt
 * start and `now` the server clock. Exactly `requiredSeconds` elapsed passes.
 */
export function evaluateTimeBarrier(input: {
  startedAt: Date | string;
  now?: Date | string;
  requiredSeconds: number;
}): TimeBarrierEvaluation {
  const startedMs = toEpochMs(input.startedAt);
  const nowMs = input.now === undefined ? Date.now() : toEpochMs(input.now);
  const requiredSeconds = Math.max(0, input.requiredSeconds);
  const requiredMs = requiredSeconds * 1000;
  const elapsedMs = Math.max(0, nowMs - startedMs);
  const passed = elapsedMs >= requiredMs;
  return {
    passed,
    elapsedMs,
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    requiredSeconds,
    remainingSeconds: passed
      ? 0
      : Math.max(1, Math.ceil((requiredMs - elapsedMs) / 1000)),
    earliestSubmitAt: new Date(startedMs + requiredMs).toISOString(),
  };
}

export interface RollingWindowEvaluation {
  allowed: boolean;
  count: number;
  limit: number;
  windowSeconds: number;
  retryAfterSeconds: number;
  retryAt: string | null;
  /** Time of the event whose expiry frees a slot (once-per-window evidence key). */
  anchor: string | null;
}

/**
 * Rolling window `(now - window, now]`. When blocked, a slot frees exactly when
 * the `(count - limit)`-th oldest event (0-based) leaves the window.
 */
export function evaluateRollingWindowLimit(input: {
  eventTimes: ReadonlyArray<Date | string>;
  now?: Date | string;
  limit: number;
  windowSeconds: number;
}): RollingWindowEvaluation {
  const nowMs = input.now === undefined ? Date.now() : toEpochMs(input.now);
  const windowMs = input.windowSeconds * 1000;
  const windowStartMs = nowMs - windowMs;
  const inWindow = input.eventTimes
    .map(toEpochMs)
    .filter((ms) => Number.isFinite(ms) && ms > windowStartMs)
    .sort((a, b) => a - b);
  const count = inWindow.length;
  const base = { count, limit: input.limit, windowSeconds: input.windowSeconds };
  if (count < input.limit) {
    return { ...base, allowed: true, retryAfterSeconds: 0, retryAt: null, anchor: null };
  }
  const anchorMs = inWindow[count - input.limit];
  const retryAtMs = anchorMs + windowMs;
  return {
    ...base,
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((retryAtMs - nowMs) / 1000)),
    retryAt: new Date(retryAtMs).toISOString(),
    anchor: new Date(anchorMs).toISOString(),
  };
}

export interface CompletionCapacityEvaluation extends RollingWindowEvaluation {
  /** Completions inside the rolling window. */
  completionsInWindow: number;
  /** The user's open (unexpired IN_PROGRESS) attempts holding a reservation. */
  inProgressAttempts: number;
}

/**
 * Code-review decision E8-D6 (2026-09-26, option A): the FR-46 completion
 * limit reserves capacity when an attempt STARTS. A start is allowed only
 * while completions in the rolling window plus the user's open attempts stay
 * below the limit, so an attempt that was allowed to start can always be
 * completed (an honest respondent never loses finished work to a 429 after
 * the 30-minute reservation). A completion turns a reservation into a
 * completion (no double counting); an abandoned, locked or expired attempt
 * releases its reservation.
 *
 * When blocked, a slot frees at the earliest time `count - limit + 1` items
 * have left: a completion leaves at `submittedAt + window`, an open attempt
 * (at best) at `startedAt + reservation` (its expiry).
 */
export function evaluateCompletionCapacity(input: {
  completionTimes: ReadonlyArray<Date | string>;
  openAttemptStartTimes: ReadonlyArray<Date | string>;
  now?: Date | string;
  limit: number;
  windowSeconds: number;
  reservationSeconds: number;
}): CompletionCapacityEvaluation {
  const nowMs = input.now === undefined ? Date.now() : toEpochMs(input.now);
  const windowMs = input.windowSeconds * 1000;
  const reservationMs = input.reservationSeconds * 1000;
  const completionReleases = input.completionTimes
    .map(toEpochMs)
    .filter((ms) => Number.isFinite(ms) && ms > nowMs - windowMs)
    .map((ms) => ms + windowMs);
  const reservationReleases = input.openAttemptStartTimes
    .map(toEpochMs)
    .filter((ms) => Number.isFinite(ms) && ms + reservationMs > nowMs)
    .map((ms) => ms + reservationMs);
  const releases = [...completionReleases, ...reservationReleases].sort(
    (a, b) => a - b,
  );
  const count = releases.length;
  const base = {
    count,
    limit: input.limit,
    windowSeconds: input.windowSeconds,
    completionsInWindow: completionReleases.length,
    inProgressAttempts: reservationReleases.length,
  };
  if (count < input.limit) {
    return { ...base, allowed: true, retryAfterSeconds: 0, retryAt: null, anchor: null };
  }
  const retryAtMs = releases[count - input.limit];
  return {
    ...base,
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((retryAtMs - nowMs) / 1000)),
    retryAt: new Date(retryAtMs).toISOString(),
    // The release of the blocking item keys the once-per-window evidence.
    anchor: new Date(retryAtMs).toISOString(),
  };
}

/** `error.details` of `422 SUBMISSION_TOO_FAST`. */
export const timeBarrierRejectionDetailsSchema = z
  .object({
    requiredSeconds: z.number().int().nonnegative(),
    elapsedSeconds: z.number().int().nonnegative(),
    remainingSeconds: z.number().int().positive(),
    retryAfterSeconds: z.number().int().positive(),
    earliestSubmitAt: z.string().datetime(),
    /** null for External forms (question count unknown). */
    questionCount: z.number().int().nonnegative().nullable(),
    secondsPerQuestion: z.number().int().positive().nullable(),
    publisherMinimumSeconds: z.number().int().nonnegative().nullable(),
    policyVersion: z.string().min(1),
  })
  .strict();
export type TimeBarrierRejectionDetails = z.infer<
  typeof timeBarrierRejectionDetailsSchema
>;

/** `error.details` of `429 PARTICIPATION_RATE_LIMITED` (plus a `Retry-After` header). */
export const participationRateLimitDetailsSchema = z
  .object({
    scope: participationRateLimitScopeSchema,
    limit: z.number().int().positive(),
    windowSeconds: z.number().int().positive(),
    retryAfterSeconds: z.number().int().positive(),
    retryAt: z.string().datetime(),
    policyVersion: z.string().min(1),
    /**
     * Decision E8-D6: a start refused by the completion limit also reports
     * the completions in the window and the user's open attempts (which hold
     * reserved capacity). Absent on burst limits.
     */
    completionsInWindow: z.number().int().nonnegative().optional(),
    inProgressAttempts: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ParticipationRateLimitDetails = z.infer<
  typeof participationRateLimitDetailsSchema
>;

/** Barrier announced when an attempt starts (the server stays authoritative). */
export const attemptTimeBarrierSchema = z
  .object({
    requiredSeconds: z.number().int().nonnegative(),
    questionCount: z.number().int().nonnegative().nullable(),
    secondsPerQuestion: z.number().int().positive().nullable(),
    earliestSubmitAt: z.string().datetime(),
    policyVersion: z.string().min(1),
  })
  .strict();
export type AttemptTimeBarrierDto = z.infer<typeof attemptTimeBarrierSchema>;

/**
 * Evidence the hard security controls hand to the (Phase-2) Research Integrity
 * Engine inside `IntegrityAssessmentRequested`. Never used for scoring here.
 */
export const timeBarrierEvidenceSchema = z
  .object({
    policyVersion: z.string().min(1),
    requiredSeconds: z.number().int().nonnegative(),
    elapsedSeconds: z.number().int().nonnegative(),
    questionCount: z.number().int().nonnegative(),
  })
  .strict();

export const securityEvidenceSchema = z
  .object({
    timeBarrier: timeBarrierEvidenceSchema.optional(),
  })
  .strict();
export type SecurityEvidence = z.infer<typeof securityEvidenceSchema>;
