import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { EnvService } from '../config/env.service';
import { CLOCK, Clock } from '../time/clock';
import {
  JOB_LEASE_REPOSITORY,
  JobLeaseRepository,
  JobRunStatus,
} from './job-lease.repository';
import {
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
  ScheduledJobRegistry,
} from './scheduled-job';
import {
  SCHEDULER_CATCH_UP_DELAY_MS,
  SCHEDULER_MAX_FAILURE_BACKOFF_MS,
  SCHEDULER_SHUTDOWN_GRACE_MS,
} from './scheduler.constants';
import { safeErrorCode } from './safe-error';

export type JobRunOutcome =
  | { job: string; outcome: 'SKIPPED'; reason: 'NOT_DUE' | 'HELD' }
  | {
      job: string;
      outcome: JobRunStatus;
      runId: string;
      counts: Record<string, number>;
      hasMore: boolean;
    };

const ERROR_MAX_LENGTH = 500;

/**
 * Story IR.2b Task 3 (AC1, AD-5 amendment, AD-17): one logical scheduler owner
 * in-process, behind `SCHEDULER_ENABLED` (never under NODE_ENV=test). One
 * `setInterval` tick (unref'd) starts every due job that is not already
 * running in this process (review MEDIUM-5: jobs run concurrently, so a long
 * scan never delays `outbox-dispatch`); a job never overlaps itself and each
 * run holds its own PostgreSQL lease with a fencing token.
 * `tick()` / `runJobOnce()` are for tests and the e2e runs, never HTTP.
 */
@Injectable()
export class SchedulerRunnerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('Scheduler');
  readonly owner = `${hostname()}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  /** Runs in flight in this process, by job name. */
  private readonly running = new Map<string, Promise<JobRunOutcome>>();
  private stopping = false;

  constructor(
    private readonly env: EnvService,
    private readonly registry: ScheduledJobRegistry,
    @Inject(JOB_LEASE_REPOSITORY) private readonly leases: JobLeaseRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  get isRunning(): boolean {
    return this.timer !== null;
  }

  onApplicationBootstrap(): void {
    if (!this.env.schedulerEnabled && this.env.isProduction) {
      // Review LOW-14: nothing time-based runs (48 h release, deadline
      // close, upload cleanup) unless exactly one replica enables it.
      this.logger.error(
        'SCHEDULER_DISABLED_IN_PRODUCTION: set SCHEDULER_ENABLED=true on exactly one API replica, otherwise pending rewards, deadlines and uploads are never processed.',
      );
    }
    if (!this.env.schedulerEnabled || this.env.isTest) {
      this.logger.log(
        `SCHEDULER_DISABLED ${JSON.stringify({
          enabled: this.env.schedulerEnabled,
          nodeEnv: this.env.nodeEnv,
        })}`,
      );
      return;
    }
    this.logger.log(
      `SCHEDULER_STARTED ${JSON.stringify({
        owner: this.owner,
        tickSeconds: this.env.schedulerTickSeconds,
        jobs: this.registry.list().map((job) => job.name),
      })}`,
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, this.env.schedulerTickSeconds * 1000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Review MEDIUM-3: runs see `stopping` through `shouldContinue()`, finish
    // their current item and complete (releasing their lease) before Prisma
    // disconnects in `onApplicationShutdown`. A run still going after the
    // grace leaves its lease to expire; the next owner takes it over with a
    // higher fencing token.
    if (this.running.size > 0) {
      let grace: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all(this.running.values()),
        new Promise<void>((resolve) => {
          grace = setTimeout(resolve, SCHEDULER_SHUTDOWN_GRACE_MS);
          grace.unref();
        }),
      ]);
      if (grace) clearTimeout(grace);
    }
  }

  /**
   * Starts every due job not already running here, concurrently; resolves
   * when the runs it started finished.
   */
  async tick(): Promise<void> {
    if (this.stopping) return;
    const jobs = this.registry.list();
    try {
      await this.leases.ensureJobs(
        jobs.map((job) => job.name),
        this.clock.now(),
      );
    } catch (error) {
      this.logger.error(`SCHEDULER_TICK_FAILED ${safeErrorCode(error)}`);
      return;
    }
    await Promise.all(
      jobs
        .filter((job) => !this.running.has(job.name))
        .map((job) => this.track(job, false)),
    );
  }

  private track(job: ScheduledJob, ignoreSchedule: boolean) {
    const run = this.runJob(job, ignoreSchedule).finally(() => {
      this.running.delete(job.name);
    });
    this.running.set(job.name, run);
    return run;
  }

  /** Runs one job now (ignores its schedule, still honours its lease). */
  async runJobOnce(name: string): Promise<JobRunOutcome> {
    const job = this.registry.get(name);
    if (!job) {
      throw new Error(`Unknown scheduled job "${name}".`);
    }
    if (this.running.has(job.name)) {
      return { job: job.name, outcome: 'SKIPPED', reason: 'HELD' };
    }
    await this.leases.ensureJobs([job.name], this.clock.now());
    return this.track(job, true);
  }

  private async runJob(
    job: ScheduledJob,
    ignoreSchedule: boolean,
  ): Promise<JobRunOutcome> {
    const now = this.clock.now();
    let acquired;
    try {
      acquired = await this.leases.tryAcquire(
        job.name,
        this.owner,
        now,
        job.leaseTtlMs,
        ignoreSchedule,
      );
    } catch (error) {
      this.logger.error(
        `SCHEDULER_TICK_FAILED ${JSON.stringify({ job: job.name })} ${safeErrorCode(error)}`,
      );
      return { job: job.name, outcome: 'SKIPPED', reason: 'HELD' };
    }
    if (!acquired.acquired) {
      if (acquired.reason === 'HELD') {
        this.logger.debug(
          `SCHEDULER_CLAIM_CONFLICT ${JSON.stringify({ job: job.name, owner: this.owner })}`,
        );
      }
      return { job: job.name, outcome: 'SKIPPED', reason: acquired.reason };
    }

    const { fencingToken, consecutiveFailures } = acquired.lease;
    const runId = randomUUID();
    const startedMs = Date.now();
    let leaseLost = false;
    const prefix = JSON.stringify({ job: job.name, runId });
    const ctx: JobRunContext = {
      runId,
      now,
      owner: this.owner,
      fencingToken,
      logger: {
        log: (message) => this.logger.log(`${prefix} ${message}`),
        warn: (message) => this.logger.warn(`${prefix} ${message}`),
        error: (message) => this.logger.error(`${prefix} ${message}`),
        debug: (message) => this.logger.debug(`${prefix} ${message}`),
      },
      shouldContinue: async () => {
        if (this.stopping || leaseLost) return false;
        const renewed = await this.leases
          .renew(
            job.name,
            this.owner,
            fencingToken,
            this.clock.now(),
            job.leaseTtlMs,
          )
          .catch(() => false);
        if (!renewed) {
          leaseLost = true;
          this.logger.warn(
            `SCHEDULER_STALE_LEASE ${JSON.stringify({ job: job.name, runId, owner: this.owner, fencingToken })}`,
          );
        }
        return renewed;
      },
    };

    let status: JobRunStatus;
    let summary: JobRunSummary | null = null;
    let error: string | null = null;
    let nextRunAt: Date;
    let failures = 0;
    try {
      summary = await job.run(ctx);
      status = leaseLost ? 'LEASE_LOST' : summary.status;
      nextRunAt = new Date(
        now.getTime() +
          (summary.hasMore && !leaseLost
            ? SCHEDULER_CATCH_UP_DELAY_MS
            : job.intervalMs),
      );
    } catch (thrown) {
      status = 'FAILED';
      failures = consecutiveFailures + 1;
      error = safeErrorCode(thrown).slice(0, ERROR_MAX_LENGTH);
      nextRunAt = new Date(
        now.getTime() +
          Math.min(
            job.intervalMs * 2 ** consecutiveFailures,
            SCHEDULER_MAX_FAILURE_BACKOFF_MS,
          ),
      );
    }

    const counts = summary?.counts ?? {};
    const completed = await this.leases
      .complete(job.name, this.owner, fencingToken, this.clock.now(), {
        status,
        nextRunAt,
        consecutiveFailures: failures,
        summary: summary ? counts : null,
        error,
      })
      .catch(() => false);
    if (!completed) {
      status = 'LEASE_LOST';
      this.logger.warn(
        `SCHEDULER_STALE_LEASE ${JSON.stringify({ job: job.name, runId, owner: this.owner, fencingToken })}`,
      );
    }

    const line = `SCHEDULER_JOB_RUN ${JSON.stringify({
      job: job.name,
      runId,
      owner: this.owner,
      fencingToken,
      outcome: status,
      counts,
      durationMs: Date.now() - startedMs,
    })}`;
    if (status === 'FAILED') {
      this.logger.error(`${line} ${error ?? ''}`);
    } else {
      this.logger.log(line);
    }

    return {
      job: job.name,
      outcome: status,
      runId,
      counts,
      hasMore: summary?.hasMore ?? false,
    };
  }
}
