import {
  DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY,
  ParticipationRateLimitDetails,
  ParticipationRateLimitPolicy,
  ParticipationRateLimitScope,
  RESERVATION_EXPIRY_MS,
  evaluateCompletionCapacity,
  evaluateRollingWindowLimit,
  resolveParticipationRateLimitPolicyVersion,
} from '@rescom/schemas';
import { RateLimitCounterStorePort } from '../../../common/security/rate-limit-counter-store.port';
import {
  CompletionLimitCheck,
  ParticipationRepositoryPort,
} from './ports/participation-repository.port';
import { ParticipationRateLimitedException } from './exceptions/participation.exceptions';

export type ParticipationBurstAction = Exclude<
  ParticipationRateLimitScope,
  'COMPLETIONS'
>;

export interface CompletionCapacityContext {
  action: ParticipationBurstAction;
  formId?: string;
  attemptId?: string;
}

/**
 * Epic 8 review P4 (FR-47): the ids a rate-limited request asked for. The
 * burst check runs before any lookup, so these are the validated route/body
 * values ("requested"), not verified ownership.
 */
export interface ParticipationBurstTarget {
  formId?: string | null;
  responseId?: string;
  attemptId?: string;
}

/**
 * Story 8.2 (FR-46, NFR-4, AD-6) — per authenticated user rate limits for
 * survey participation, a centrally versioned policy (decision E8-D4: the
 * deployment's `PARTICIPATION_RATE_LIMIT_POLICY_VERSION`, default
 * `participation-rate-limit-v1`, is stamped on every 429 and FraudLog entry):
 *
 * 1. Request bursts per user and action, counted in the ephemeral
 *    `RateLimitCounterStorePort` (per-process today, Redis for `REDIS_SHARED`).
 * 2. The FR-46 completion limit, counted from the PostgreSQL-authoritative
 *    completed attempts in a rolling window (correct across replicas).
 *
 * A rejection never consumes anything; it records one FraudLog `RATE_LIMIT`
 * entry per window (hard-rule violation evidence, deduplicated by key) and
 * throws `ParticipationRateLimitedException` (429 + Retry-After).
 *
 * Decision E8-D6 (option A): the completion limit reserves capacity when an
 * attempt STARTS — `assertStartCapacity` counts completions in the window
 * plus the user's open attempts (cheap pre-check), and the start transaction
 * re-checks the same count under the user's lock (`completionLimitCheck` as
 * `completionReservation`); a raced refusal is reported through
 * `rejectStartCapacity` after that transaction ended. An attempt that was
 * allowed to start can therefore always complete: submit and verify no
 * longer pre-check the limit. The completion transactions keep the Epic 8
 * review P3 backstop (completed attempts only, so a reserved attempt is never
 * counted twice), reported through `rejectCompletions`.
 */
export class ParticipationRateLimiter {
  constructor(
    private readonly counterStore: RateLimitCounterStorePort,
    private readonly participationRepository: ParticipationRepositoryPort,
    private readonly policy: ParticipationRateLimitPolicy = DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Decision E8-D4: the policy version these limits run under. */
  get policyVersion(): string {
    return resolveParticipationRateLimitPolicyVersion(this.policy);
  }

  async assertBurstAllowed(
    userId: string,
    action: ParticipationBurstAction,
    target: ParticipationBurstTarget = {},
  ): Promise<void> {
    const now = this.clock();
    const hit = await this.counterStore.increment(
      `participation:${action}:${userId}`,
      this.policy.burstWindowSeconds * 1000,
      now,
    );
    if (hit.hits <= this.policy.burstLimit) {
      return;
    }

    const details: ParticipationRateLimitDetails = {
      scope: action,
      limit: this.policy.burstLimit,
      windowSeconds: this.policy.burstWindowSeconds,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((hit.resetAt.getTime() - now.getTime()) / 1000),
      ),
      retryAt: hit.resetAt.toISOString(),
      policyVersion: this.policyVersion,
    };
    // Only the first rejected request of a window records evidence; the unique
    // key is the durable backstop (retries, several replicas).
    if (hit.hits === this.policy.burstLimit + 1) {
      await this.recordEvidence(
        userId,
        details,
        `rate-limit:${userId}:${action}:${hit.windowStartedAt.getTime()}`,
        {
          requestsInWindow: hit.hits,
          ...(target.formId ? { requestedFormId: target.formId } : {}),
          ...(target.responseId
            ? { requestedResponseId: target.responseId }
            : {}),
          ...(target.attemptId ? { requestedAttemptId: target.attemptId } : {}),
        },
      );
    }
    throw new ParticipationRateLimitedException(details);
  }

  /**
   * Decision E8-D6: the start-time reservation check (cheap pre-check; the
   * start transaction re-checks it under the user's lock). Counts the user's
   * completions in the rolling window plus their open attempts (unexpired
   * IN_PROGRESS on any form, each holding a reservation).
   */
  async assertStartCapacity(
    userId: string,
    context: CompletionCapacityContext,
  ): Promise<void> {
    const now = this.clock();
    const windowSeconds = this.policy.completionWindowSeconds;
    const [completionTimes, openAttemptStartTimes] = await Promise.all([
      this.participationRepository.findCompletionTimesSince(
        userId,
        new Date(now.getTime() - windowSeconds * 1000),
      ),
      this.participationRepository.findOpenAttemptStartTimes(
        userId,
        new Date(now.getTime() - RESERVATION_EXPIRY_MS),
      ),
    ]);
    const evaluation = evaluateCompletionCapacity({
      completionTimes,
      openAttemptStartTimes,
      now,
      limit: this.policy.completionLimit,
      windowSeconds,
      reservationSeconds: RESERVATION_EXPIRY_MS / 1000,
    });
    if (evaluation.allowed) {
      return;
    }
    await this.rejectStartCapacity(
      userId,
      completionTimes,
      openAttemptStartTimes,
      context,
      now,
    );
  }

  /**
   * Decision E8-D6: refuses a start at the reserved completion limit —
   * records the once-per-window evidence (keyed by the release of the
   * blocking completion or reservation) and throws the 429 `COMPLETIONS`
   * with the completions and open attempts. Callers that learned the limit
   * inside the start transaction call it only after that transaction ended.
   */
  async rejectStartCapacity(
    userId: string,
    completionTimes: ReadonlyArray<Date>,
    openAttemptStartTimes: ReadonlyArray<Date>,
    context: CompletionCapacityContext,
    now: Date = this.clock(),
  ): Promise<never> {
    const windowSeconds = this.policy.completionWindowSeconds;
    const evaluation = evaluateCompletionCapacity({
      completionTimes,
      openAttemptStartTimes,
      now,
      limit: this.policy.completionLimit,
      windowSeconds,
      reservationSeconds: RESERVATION_EXPIRY_MS / 1000,
    });
    const details: ParticipationRateLimitDetails = {
      scope: 'COMPLETIONS',
      limit: this.policy.completionLimit,
      windowSeconds,
      retryAfterSeconds: Math.max(1, evaluation.retryAfterSeconds),
      retryAt: evaluation.retryAt ?? now.toISOString(),
      policyVersion: this.policyVersion,
      completionsInWindow: evaluation.completionsInWindow,
      inProgressAttempts: evaluation.inProgressAttempts,
    };
    await this.recordEvidence(
      userId,
      details,
      `rate-limit:${userId}:COMPLETIONS:${evaluation.anchor ?? now.toISOString()}`,
      {
        blockedAction: context.action,
        ...(context.formId ? { formId: context.formId } : {}),
        ...(context.attemptId ? { attemptId: context.attemptId } : {}),
      },
    );
    throw new ParticipationRateLimitedException(details);
  }

  /**
   * Epic 8 review P3: the completion limit a transaction re-checks under the
   * user's lock (`now` is this limiter's clock) — the completion backstop,
   * and (decision E8-D6) the start-time reservation.
   */
  completionLimitCheck(userId: string): CompletionLimitCheck {
    return {
      userId,
      limit: this.policy.completionLimit,
      windowSeconds: this.policy.completionWindowSeconds,
      now: this.clock(),
    };
  }

  /**
   * Rejects a completion at the FR-46 limit (the Epic 8 review P3 backstop:
   * reachable only when a reservation was bypassed, e.g. an attempt started
   * before decision E8-D6): records the once-per-window evidence (keyed by
   * the blocking completion) and throws the 429. Callers that learned the
   * limit inside a transaction call it only after that transaction ended, so
   * the evidence is never rolled back.
   */
  async rejectCompletions(
    userId: string,
    completionTimes: ReadonlyArray<Date>,
    context: CompletionCapacityContext,
    now: Date = this.clock(),
  ): Promise<never> {
    const windowSeconds = this.policy.completionWindowSeconds;
    const evaluation = evaluateRollingWindowLimit({
      eventTimes: completionTimes,
      now,
      limit: this.policy.completionLimit,
      windowSeconds,
    });
    const details: ParticipationRateLimitDetails = {
      scope: 'COMPLETIONS',
      limit: this.policy.completionLimit,
      windowSeconds,
      retryAfterSeconds: Math.max(1, evaluation.retryAfterSeconds),
      retryAt: evaluation.retryAt ?? now.toISOString(),
      policyVersion: this.policyVersion,
    };
    // The blocking completion anchors the window: one entry until it expires.
    await this.recordEvidence(
      userId,
      details,
      `rate-limit:${userId}:COMPLETIONS:${evaluation.anchor}`,
      {
        completionsInWindow: evaluation.count,
        blockedAction: context.action,
        ...(context.formId ? { formId: context.formId } : {}),
        ...(context.attemptId ? { attemptId: context.attemptId } : {}),
      },
    );
    throw new ParticipationRateLimitedException(details);
  }

  /** Fail-closed control, fail-open evidence: the limit applies even if logging fails. */
  private async recordEvidence(
    userId: string,
    details: ParticipationRateLimitDetails,
    dedupeKey: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.participationRepository.recordFraudLog(
        userId,
        'RATE_LIMIT',
        { ...details, ...extra },
        dedupeKey,
      );
    } catch {
      // Evidence is best effort; the rejection below still happens.
    }
  }
}
