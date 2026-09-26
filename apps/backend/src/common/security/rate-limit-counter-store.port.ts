/**
 * Story 8.2 (FR-46, NFR-4, AD-6): ephemeral fixed-window request counters used
 * for per-user burst limits on participation mutations.
 *
 * Deployment profiles (AD-6, `ABUSE_CONTROL_PROFILE`):
 * - `REDIS_DISABLED_SINGLE_REPLICA` (current): `InMemoryRateLimitCounterStore`,
 *   per-process counters, valid for ONE API replica only.
 * - `REDIS_SHARED` (future): a Redis implementation of this port
 *   (`INCR key` + `PEXPIRE key windowMs NX` + `PTTL key`, atomically via Lua)
 *   is bound to `RATE_LIMIT_COUNTER_STORE` in `SecurityModule`; no application
 *   code changes. The env schema refuses that profile until it exists.
 *
 * Counters are disposable: losing them only resets a burst window. Durable
 * abuse state (Attempts, completion counts, FraudLog) stays in PostgreSQL.
 */
export const RATE_LIMIT_COUNTER_STORE = Symbol('RATE_LIMIT_COUNTER_STORE');

export interface RateLimitCounterHit {
  /** Hits in the current window, including this one. */
  hits: number;
  windowStartedAt: Date;
  resetAt: Date;
}

export interface RateLimitCounterStorePort {
  /**
   * Atomically records one hit for `key` in a fixed window of `windowMs`
   * (anchored at the first hit) and returns the updated window state.
   */
  increment(
    key: string,
    windowMs: number,
    now?: Date,
  ): Promise<RateLimitCounterHit>;
}
