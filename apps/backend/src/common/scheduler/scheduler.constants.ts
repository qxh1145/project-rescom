/**
 * Story IR.2b: per-job cadences, leases and batch sizes. Code constants, not
 * env vars: Story 11.1 needs exactly one flag (`SCHEDULER_ENABLED`). Defaults
 * are the story's Q10 answer (Outbox every tick, pending release / reservation
 * expiry / deadline close every 5 min, starter expiry hourly).
 */
const MINUTE_MS = 60_000;

export const SCHEDULER_SHUTDOWN_GRACE_MS = 10_000;
/** `hasMore` with the per-run budget spent: run again soon (catch-up). */
export const SCHEDULER_CATCH_UP_DELAY_MS = 5_000;
/** Failure backoff cap: `min(interval · 2^consecutiveFailures, 1 h)`. */
export const SCHEDULER_MAX_FAILURE_BACKOFF_MS = 60 * MINUTE_MS;
/** A job is degraded after this many consecutive failed runs. */
export const SCHEDULER_DEGRADED_FAILURES = 3;
/** Overdue: `now − next_run_at > 3 × interval` while enabled. */
export const SCHEDULER_OVERDUE_FACTOR = 3;
/** Degraded when the oldest subscribed available Outbox event is older. */
export const SCHEDULER_DEGRADED_OUTBOX_AGE_MS = 15 * MINUTE_MS;
/** Public `/system/health` reuses one scheduler snapshot this long. */
export const SCHEDULER_HEALTH_CACHE_MS = 10_000;
/** Per-run budget of the paged scanner jobs (batches between lease renewals). */
export const SCHEDULER_MAX_BATCHES_PER_RUN = 20;

export const OUTBOX_DISPATCH_JOB = {
  name: 'outbox-dispatch',
  leaseTtlMs: 60_000,
  batchSize: 20,
  maxBatches: 10,
} as const;
/** One handler's interactive transaction (kind (a) effects are short). */
export const OUTBOX_TX_MAX_WAIT_MS = 2_000;
export const OUTBOX_TX_TIMEOUT_MS = 10_000;
/** Per-row claim lease of a dispatched event. */
export const OUTBOX_CLAIM_LEASE_MS = 60_000;
/** Retry backoff: 30 s · 2^(attempts − 1), capped at 1 h, ±20 % jitter. */
export const OUTBOX_BACKOFF_BASE_MS = 30_000;
export const OUTBOX_BACKOFF_MAX_MS = 60 * MINUTE_MS;
export const OUTBOX_BACKOFF_JITTER = 0.2;
export const OUTBOX_LAST_ERROR_MAX_LENGTH = 500;

export const PENDING_RELEASE_JOB = {
  name: 'pending-release',
  intervalMs: 5 * MINUTE_MS,
  leaseTtlMs: 5 * MINUTE_MS,
  batchSize: 100,
} as const;

export const STARTER_EXPIRY_JOB = {
  name: 'starter-expiry',
  intervalMs: 60 * MINUTE_MS,
  leaseTtlMs: 10 * MINUTE_MS,
  batchSize: 100,
} as const;

/** Extra wait past the 30-minute reservation before the system acts. */
export const RESERVATION_GRACE_MS = 2 * MINUTE_MS;

export const RESERVATION_EXPIRY_JOB = {
  name: 'reservation-expiry',
  intervalMs: 5 * MINUTE_MS,
  leaseTtlMs: 5 * MINUTE_MS,
  batchSize: 200,
} as const;

export const DEADLINE_CLOSE_JOB = {
  name: 'deadline-close',
  intervalMs: 5 * MINUTE_MS,
  leaseTtlMs: 5 * MINUTE_MS,
  batchSize: 25,
} as const;

export const STORAGE_CLEANUP_JOB = {
  name: 'storage-cleanup',
  intervalMs: 60 * MINUTE_MS,
  leaseTtlMs: 15 * MINUTE_MS,
} as const;
