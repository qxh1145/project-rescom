import {
  RateLimitCounterHit,
  RateLimitCounterStorePort,
} from './rate-limit-counter-store.port';

interface CounterWindow {
  hits: number;
  windowStartedAtMs: number;
  resetAtMs: number;
}

/**
 * Single-process counter store for the `REDIS_DISABLED_SINGLE_REPLICA`
 * abuse-control profile (AD-6). Node's event loop makes each increment atomic
 * within the process. Memory is bounded by `maxEntries` (Epic 8 review P10):
 * a new key at capacity first evicts expired windows, then the least recently
 * (re)started window. Evicting a live window only resets that user's
 * ephemeral burst counter; the durable completion limit is unaffected.
 */
export class InMemoryRateLimitCounterStore implements RateLimitCounterStorePort {
  /** Insertion order = window (re)start order, so the first key is the oldest. */
  private readonly windows = new Map<string, CounterWindow>();
  private readonly maxEntries: number;
  /**
   * No window expires before this time (the earliest `resetAtMs` seen by the
   * last scan or set since), so a full scan before it would evict nothing.
   */
  private nextSweepAtMs = Number.POSITIVE_INFINITY;

  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 50_000;
  }

  get size(): number {
    return this.windows.size;
  }

  async increment(
    key: string,
    windowMs: number,
    now: Date = new Date(),
  ): Promise<RateLimitCounterHit> {
    const nowMs = now.getTime();
    let window = this.windows.get(key);
    if (!window || window.resetAtMs <= nowMs) {
      if (window) {
        // delete + set moves the restarted window to the end (most recent).
        this.windows.delete(key);
      } else if (this.windows.size >= this.maxEntries) {
        this.makeRoom(nowMs);
      }
      window = {
        hits: 0,
        windowStartedAtMs: nowMs,
        resetAtMs: nowMs + windowMs,
      };
      this.windows.set(key, window);
      this.nextSweepAtMs = Math.min(this.nextSweepAtMs, window.resetAtMs);
    }
    window.hits += 1;
    return {
      hits: window.hits,
      windowStartedAt: new Date(window.windowStartedAtMs),
      resetAt: new Date(window.resetAtMs),
    };
  }

  private makeRoom(nowMs: number): void {
    if (nowMs >= this.nextSweepAtMs) {
      this.evictExpired(nowMs);
    }
    while (this.windows.size >= this.maxEntries) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }
  }

  private evictExpired(nowMs: number): void {
    let nextSweepAtMs = Number.POSITIVE_INFINITY;
    for (const [key, window] of this.windows) {
      if (window.resetAtMs <= nowMs) {
        this.windows.delete(key);
      } else if (window.resetAtMs < nextSweepAtMs) {
        nextSweepAtMs = window.resetAtMs;
      }
    }
    this.nextSweepAtMs = nextSweepAtMs;
  }
}
