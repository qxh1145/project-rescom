/**
 * Story IR.2b (AC1, AC8): the contract of a job run by the in-process
 * scheduler. Framework-free, so a context's job adapter only needs this file
 * and its own application commands. Jobs self-register in their module's
 * `onModuleInit`; `common/` never imports feature modules.
 */

export interface JobLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface JobRunContext {
  /** Fresh UUID per run (correlation id of every log line of the run). */
  runId: string;
  /** The clock's time when the lease was acquired. */
  now: Date;
  owner: string;
  /** The lease's fencing token (BIGINT as a string). */
  fencingToken: string;
  /**
   * Renews the lease (compare-and-set on owner + token). False when the
   * scheduler is stopping or the lease was lost: the job must stop.
   */
  shouldContinue(): Promise<boolean>;
  logger: JobLogger;
}

export interface JobRunSummary {
  /** PARTIAL: some items failed (they are retried by a later run). */
  status: 'SUCCEEDED' | 'PARTIAL';
  /** Counts only — never user ids, payloads or balances (AD-18). */
  counts: Record<string, number>;
  /** Work remains (budget spent): the runner schedules a catch-up run. */
  hasMore: boolean;
}

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  leaseTtlMs: number;
  run(ctx: JobRunContext): Promise<JobRunSummary>;
}

export class ScheduledJobRegistry {
  private readonly jobs = new Map<string, ScheduledJob>();

  register(job: ScheduledJob): void {
    if (this.jobs.has(job.name)) {
      throw new Error(`Scheduled job "${job.name}" is already registered.`);
    }
    this.jobs.set(job.name, job);
  }

  get(name: string): ScheduledJob | undefined {
    return this.jobs.get(name);
  }

  /** In registration order (the order of a tick). */
  list(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }
}

/**
 * Review LOW-6: a run in which every attempted item failed is a FAILED run
 * (backoff, `consecutiveFailures`, health `degraded`), not a PARTIAL one.
 */
export class AllItemsFailedError extends Error {
  readonly code = 'ALL_ITEMS_FAILED';

  constructor(job: string, failed: number) {
    super(`${job}: all ${failed} attempted item(s) failed`);
    this.name = 'AllItemsFailedError';
  }
}

export function assertNotAllFailed(
  job: string,
  failed: number,
  attempted: number,
): void {
  if (failed > 0 && failed >= attempted) {
    throw new AllItemsFailedError(job, failed);
  }
}

/** Sums `counts` of paged batches (job adapters). */
export function addCounts(
  total: Record<string, number>,
  batch: Record<string, number>,
): void {
  for (const [key, value] of Object.entries(batch)) {
    total[key] = (total[key] ?? 0) + value;
  }
}
