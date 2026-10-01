import { Logger } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { FixedClock } from '../time/clock';
import { InMemoryJobLeaseRepository } from './job-lease.repository';
import {
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
  ScheduledJobRegistry,
} from './scheduled-job';
import { SchedulerRunnerService } from './scheduler-runner.service';

const BASE_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

function env(overrides: Record<string, unknown> = {}): EnvService {
  return new EnvService({ ...BASE_ENV, ...overrides });
}

class FakeJob implements ScheduledJob {
  runs: JobRunContext[] = [];
  result: JobRunSummary | Error = {
    status: 'SUCCEEDED',
    counts: { done: 1 },
    hasMore: false,
  };
  onRun?: (ctx: JobRunContext) => Promise<void>;

  constructor(
    readonly name = 'fake',
    readonly intervalMs = 60_000,
    readonly leaseTtlMs = 30_000,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    this.runs.push(ctx);
    if (this.onRun) await this.onRun(ctx);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe('SchedulerRunnerService (Story IR.2b Task 3)', () => {
  const start = new Date('2026-10-01T00:00:00.000Z');
  let clock: FixedClock;
  let leases: InMemoryJobLeaseRepository;
  let registry: ScheduledJobRegistry;
  let job: FakeJob;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    clock = new FixedClock(start);
    leases = new InMemoryJobLeaseRepository();
    registry = new ScheduledJobRegistry();
    job = new FakeJob();
    registry.register(job);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function runner(envService = env()): SchedulerRunnerService {
    return new SchedulerRunnerService(envService, registry, leases, clock);
  }

  describe('T1: flag and NODE_ENV', () => {
    it.each([
      ['the flag is off (default)', env()],
      [
        'NODE_ENV=test even with the flag on',
        env({ NODE_ENV: 'test', SCHEDULER_ENABLED: 'true' }),
      ],
    ])('creates no timer when %s', (_label, envService) => {
      jest.useFakeTimers();
      const scheduler = runner(envService);
      scheduler.onApplicationBootstrap();
      expect(scheduler.isRunning).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('starts one unref-ed interval when enabled, and stops it on shutdown', async () => {
      jest.useFakeTimers();
      const scheduler = runner(
        env({ SCHEDULER_ENABLED: 'true', SCHEDULER_TICK_SECONDS: '5' }),
      );
      scheduler.onApplicationBootstrap();
      expect(scheduler.isRunning).toBe(true);
      expect(jest.getTimerCount()).toBe(1);

      await jest.advanceTimersByTimeAsync(5_000);
      expect(job.runs).toHaveLength(1);

      await scheduler.onModuleDestroy();
      expect(scheduler.isRunning).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('rejects duplicate job names', () => {
    expect(() => registry.register(new FakeJob('fake'))).toThrow(
      /already registered/,
    );
  });

  it('runs a due job, records the outcome and schedules the next run', async () => {
    await runner().tick();

    expect(job.runs).toHaveLength(1);
    const [row] = await leases.list();
    expect(row).toMatchObject({
      jobName: 'fake',
      leaseOwner: null,
      fencingToken: '1',
      lastStatus: 'SUCCEEDED',
      lastSummary: { done: 1 },
      consecutiveFailures: 0,
    });
    expect(row.nextRunAt.getTime()).toBe(start.getTime() + job.intervalMs);

    // Not due again until the interval passed.
    await runner().tick();
    expect(job.runs).toHaveLength(1);
    clock.advance(job.intervalMs);
    await runner().tick();
    expect(job.runs).toHaveLength(2);
  });

  it('a thrown job never escapes the tick; failures back off exponentially (capped)', async () => {
    job.result = new Error('database unavailable');
    const scheduler = runner();

    await expect(scheduler.tick()).resolves.toBeUndefined();
    let [row] = await leases.list();
    expect(row.lastStatus).toBe('FAILED');
    // Review LOW-10: the class (+ code) only, never the message.
    expect(row.lastError).toBe('Error');
    expect(row.consecutiveFailures).toBe(1);
    expect(row.nextRunAt.getTime() - start.getTime()).toBe(job.intervalMs);

    clock.set(row.nextRunAt);
    await scheduler.tick();
    [row] = await leases.list();
    expect(row.consecutiveFailures).toBe(2);
    expect(row.nextRunAt.getTime() - clock.now().getTime()).toBe(
      job.intervalMs * 2,
    );

    // 60 s · 2^7 > 1 h: capped.
    leases.rows.get('fake')!.consecutiveFailures = 7;
    clock.set(row.nextRunAt);
    await scheduler.tick();
    [row] = await leases.list();
    expect(row.nextRunAt.getTime() - clock.now().getTime()).toBe(3_600_000);

    job.result = { status: 'SUCCEEDED', counts: {}, hasMore: false };
    clock.set(row.nextRunAt);
    await scheduler.tick();
    [row] = await leases.list();
    expect(row.consecutiveFailures).toBe(0);
  });

  it('schedules a catch-up run 5 s later when the job reports more work', async () => {
    job.result = { status: 'PARTIAL', counts: {}, hasMore: true };
    await runner().tick();
    const [row] = await leases.list();
    expect(row.lastStatus).toBe('PARTIAL');
    expect(row.nextRunAt.getTime() - start.getTime()).toBe(5_000);
  });

  it('a job never overlaps itself (in-flight guard per job)', async () => {
    let release!: () => void;
    job.onRun = () => new Promise<void>((resolve) => (release = resolve));
    const scheduler = runner();

    const first = scheduler.tick();
    await new Promise((resolve) => setImmediate(resolve));
    clock.advance(job.intervalMs);
    await scheduler.tick();
    expect(job.runs).toHaveLength(1);

    release();
    await first;
  });

  it('review MEDIUM-5: a long job does not delay outbox dispatch', async () => {
    let release!: () => void;
    job.onRun = () => new Promise<void>((resolve) => (release = resolve));
    const dispatch = new FakeJob('outbox-dispatch', 15_000);
    registry.register(dispatch);
    const scheduler = runner();

    const first = scheduler.tick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(dispatch.runs).toHaveLength(1);

    clock.advance(15_000);
    await scheduler.tick();
    expect(dispatch.runs).toHaveLength(2);
    expect(job.runs).toHaveLength(1);

    release();
    await first;
  });

  it('review MEDIUM-3: a graceful stop lets the run finish its item and release its lease', async () => {
    let entered!: () => void;
    const inRun = new Promise<void>((resolve) => (entered = resolve));
    let continued: boolean | undefined;
    job.onRun = async (ctx) => {
      entered();
      await new Promise((resolve) => setImmediate(resolve));
      continued = await ctx.shouldContinue();
    };
    const scheduler = runner();

    const run = scheduler.tick();
    await inRun;
    await scheduler.onModuleDestroy();
    await run;

    expect(continued).toBe(false);
    const [row] = (await leases.list()).filter((r) => r.jobName === 'fake');
    expect(row).toMatchObject({ leaseOwner: null, lastStatus: 'SUCCEEDED' });
    // Stopped: no new run starts.
    clock.advance(job.intervalMs);
    await scheduler.tick();
    expect(job.runs).toHaveLength(1);
  });

  it('review LOW-14: logs an error at boot when disabled in production', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error');
    runner({
      schedulerEnabled: false,
      isProduction: true,
      isTest: false,
      nodeEnv: 'production',
    } as unknown as EnvService).onApplicationBootstrap();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('SCHEDULER_DISABLED_IN_PRODUCTION'),
    );
  });

  it('T3: a run whose lease was taken over stops and cannot record its outcome', async () => {
    const other = new SchedulerRunnerService(env(), registry, leases, clock);
    let continued: boolean | undefined;
    job.onRun = async (ctx) => {
      // The lease expires and another owner takes the job over.
      clock.advance(job.leaseTtlMs + 1);
      const takeover = await leases.tryAcquire(
        'fake',
        other.owner,
        clock.now(),
        job.leaseTtlMs,
        true,
      );
      expect(takeover).toMatchObject({
        acquired: true,
        lease: { fencingToken: '2' },
      });
      continued = await ctx.shouldContinue();
    };

    const outcome = await runner().runJobOnce('fake');

    expect(continued).toBe(false);
    expect(outcome.outcome).toBe('LEASE_LOST');
    const [row] = await leases.list();
    // The newer owner still holds it; the stale completion changed nothing.
    expect(row.leaseOwner).toBe(other.owner);
    expect(row.fencingToken).toBe('2');
    expect(row.lastStatus).toBeNull();
  });

  it('T2: two runners never hold the same lease; the loser skips', async () => {
    let inside = 0;
    let maxInside = 0;
    job.onRun = async () => {
      inside++;
      maxInside = Math.max(maxInside, inside);
      await new Promise((resolve) => setImmediate(resolve));
      inside--;
    };
    const [a, b] = await Promise.all([
      runner().runJobOnce('fake'),
      runner().runJobOnce('fake'),
    ]);
    expect(maxInside).toBe(1);
    expect([a.outcome, b.outcome].sort()).toEqual(['SKIPPED', 'SUCCEEDED']);
  });

  it('runJobOnce ignores the schedule but still honours a live lease', async () => {
    await runner().tick();
    expect((await runner().runJobOnce('fake')).outcome).toBe('SUCCEEDED');
    await expect(runner().runJobOnce('unknown')).rejects.toThrow(
      /Unknown scheduled job/,
    );
  });
});
