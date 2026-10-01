import { Inject, Injectable } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { CLOCK, Clock } from '../time/clock';
import {
  JOB_LEASE_REPOSITORY,
  JobLeaseRepository,
} from './job-lease.repository';
import {
  OUTBOX_CLAIM_REPOSITORY,
  OutboxBacklog,
  OutboxClaimRepository,
} from './outbox/outbox-claim.repository';
import { OutboxHandlerRegistry } from './outbox/outbox-handler';
import { ScheduledJobRegistry } from './scheduled-job';
import {
  SCHEDULER_DEGRADED_FAILURES,
  SCHEDULER_DEGRADED_OUTBOX_AGE_MS,
  SCHEDULER_HEALTH_CACHE_MS,
  SCHEDULER_OVERDUE_FACTOR,
} from './scheduler.constants';

export type SchedulerStatus = 'ok' | 'degraded' | 'disabled';

export interface SchedulerJobHealth {
  name: string;
  lastStatus: string | null;
  lastFinishedAt: string | null;
  nextRunAt: string | null;
  consecutiveFailures: number;
  overdue: boolean;
}

export interface SchedulerHealthSnapshot {
  enabled: boolean;
  status: SchedulerStatus;
  jobs: SchedulerJobHealth[];
  outbox: OutboxBacklog;
}

/**
 * Story IR.2b Task 10.2 (AC8): readiness and metrics view of the scheduler
 * (reused by Story 11.1's readiness endpoint). Bounded aggregate reads only.
 * `degraded`: a job overdue (`now − next_run_at > 3 × interval`) or failing
 * 3 times in a row, or the oldest due subscribed Outbox event older than
 * 15 min.
 */
@Injectable()
export class SchedulerHealthService {
  constructor(
    private readonly env: EnvService,
    private readonly jobs: ScheduledJobRegistry,
    private readonly handlers: OutboxHandlerRegistry,
    @Inject(JOB_LEASE_REPOSITORY) private readonly leases: JobLeaseRepository,
    @Inject(OUTBOX_CLAIM_REPOSITORY)
    private readonly outbox: OutboxClaimRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Scheduler enabled in this process (the flag, and not NODE_ENV=test). */
  get enabled(): boolean {
    return this.env.schedulerEnabled && !this.env.isTest;
  }

  private cache: {
    at: number;
    value: Promise<SchedulerHealthSnapshot>;
  } | null = null;

  /**
   * Review LOW-11: the public `/system/health` shares one snapshot per
   * `SCHEDULER_HEALTH_CACHE_MS`, so polling never runs the Outbox aggregate
   * per call. A failed read is not cached.
   */
  cachedSnapshot(): Promise<SchedulerHealthSnapshot> {
    const nowMs = Date.now();
    if (!this.cache || nowMs - this.cache.at > SCHEDULER_HEALTH_CACHE_MS) {
      const value = this.snapshot();
      this.cache = { at: nowMs, value };
      value.catch(() => {
        if (this.cache?.value === value) this.cache = null;
      });
    }
    return this.cache.value;
  }

  async snapshot(
    now: Date = this.clock.now(),
  ): Promise<SchedulerHealthSnapshot> {
    const enabled = this.enabled;
    const [rows, outbox] = await Promise.all([
      this.leases.list(),
      this.outbox.backlog(this.handlers.subscribedEventTypes(), now),
    ]);
    const byName = new Map(rows.map((row) => [row.jobName, row]));
    const jobs = this.jobs.list().map((job): SchedulerJobHealth => {
      const row = byName.get(job.name);
      return {
        name: job.name,
        lastStatus: row?.lastStatus ?? null,
        lastFinishedAt: row?.lastFinishedAt?.toISOString() ?? null,
        nextRunAt: row?.nextRunAt.toISOString() ?? null,
        consecutiveFailures: row?.consecutiveFailures ?? 0,
        overdue:
          enabled &&
          row !== undefined &&
          now.getTime() - row.nextRunAt.getTime() >
            SCHEDULER_OVERDUE_FACTOR * job.intervalMs,
      };
    });
    let status: SchedulerStatus = 'disabled';
    if (enabled) {
      const degraded =
        jobs.some(
          (job) =>
            job.overdue ||
            job.consecutiveFailures >= SCHEDULER_DEGRADED_FAILURES,
        ) ||
        (outbox.oldestAvailableAgeSeconds !== null &&
          outbox.oldestAvailableAgeSeconds * 1000 >
            SCHEDULER_DEGRADED_OUTBOX_AGE_MS);
      status = degraded ? 'degraded' : 'ok';
    }
    return { enabled, status, jobs, outbox };
  }
}
