import { Injectable, Optional } from '@nestjs/common';

export interface RateLimiterConfig {
  limit?: number;
  windowMs?: number;
  /** Hard cap on tracked IP keys; the least recently acquired are evicted. */
  maxTrackedKeys?: number;
}

/**
 * Per-IP sliding-window limiter for guest submissions (Bug 3.3).
 *
 * `tryAcquire` checks and records in one synchronous step, so concurrent
 * requests from one IP cannot all pass a check before any of them records.
 * Memory stays bounded: every call prunes keys whose window has expired and
 * the map never holds more than `maxTrackedKeys` keys (the least recently
 * acquired are evicted first). The map is ordered by last acquisition, so the
 * global prune stops at the first key that is still inside its window.
 */
@Injectable()
export class GuestSubmissionRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxTrackedKeys: number;
  // IP -> acquisition timestamps, ordered by the key's last acquisition.
  private readonly ipSubmissions = new Map<string, number[]>();

  constructor(@Optional() config?: RateLimiterConfig) {
    this.limit = config?.limit ?? 3;
    this.windowMs = config?.windowMs ?? 24 * 60 * 60 * 1000;
    this.maxTrackedKeys = config?.maxTrackedKeys ?? 10_000;
  }

  clear(): void {
    this.ipSubmissions.clear();
  }

  /** Number of IP keys currently tracked. */
  get trackedKeyCount(): number {
    return this.ipSubmissions.size;
  }

  /**
   * Takes one submission slot for `ipKey` when its window has room, and
   * records it immediately. Returns false (recording nothing) at the limit.
   */
  tryAcquire(ipKey: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    this.pruneExpiredKeys(cutoff);

    const valid = (this.ipSubmissions.get(ipKey) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );
    if (valid.length >= this.limit) {
      this.ipSubmissions.set(ipKey, valid);
      return false;
    }

    valid.push(now);
    // Re-insert so the key moves to the end (most recently acquired).
    this.ipSubmissions.delete(ipKey);
    this.ipSubmissions.set(ipKey, valid);

    while (this.ipSubmissions.size > this.maxTrackedKeys) {
      const oldestKey = this.ipSubmissions.keys().next().value as string;
      this.ipSubmissions.delete(oldestKey);
    }
    return true;
  }

  /** Gives back the most recent slot of `ipKey` (a failed submission). */
  release(ipKey: string): void {
    const timestamps = this.ipSubmissions.get(ipKey);
    if (!timestamps) return;
    timestamps.pop();
    if (timestamps.length === 0) {
      this.ipSubmissions.delete(ipKey);
    }
  }

  private pruneExpiredKeys(cutoff: number): void {
    for (const [key, timestamps] of this.ipSubmissions) {
      const newest = timestamps[timestamps.length - 1];
      if (newest !== undefined && newest > cutoff) {
        break;
      }
      this.ipSubmissions.delete(key);
    }
  }
}
