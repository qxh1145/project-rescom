import { Injectable, Optional } from '@nestjs/common';

export interface RateLimiterConfig {
  limit?: number;
  windowMs?: number;
}

@Injectable()
export class GuestSubmissionRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  // Map of IP -> array of timestamps
  private readonly ipSubmissions = new Map<string, number[]>();

  constructor(@Optional() config?: RateLimiterConfig) {
    this.limit = config?.limit ?? 3;
    this.windowMs = config?.windowMs ?? 24 * 60 * 60 * 1000;
  }

  clear(): void {
    this.ipSubmissions.clear();
  }

  private cleanOldEntries(ip: string, now: number): number[] {
    const cutoff = now - this.windowMs;
    const timestamps = this.ipSubmissions.get(ip) || [];
    const valid = timestamps.filter((t) => t > cutoff);
    if (valid.length > 0) {
      this.ipSubmissions.set(ip, valid);
    } else {
      this.ipSubmissions.delete(ip);
    }
    return valid;
  }

  async checkRateLimit(
    ip: string,
  ): Promise<{ isAllowed: boolean; remaining: number; resetTime: Date }> {
    const now = Date.now();
    const valid = this.cleanOldEntries(ip, now);
    const count = valid.length;
    const remaining = Math.max(0, this.limit - count);
    const oldestTimestamp = valid[0] ?? now;
    const resetTime = new Date(oldestTimestamp + this.windowMs);

    return {
      isAllowed: count < this.limit,
      remaining,
      resetTime,
    };
  }

  async recordSubmission(ip: string): Promise<void> {
    const now = Date.now();
    const valid = this.cleanOldEntries(ip, now);
    valid.push(now);
    this.ipSubmissions.set(ip, valid);
  }
}
