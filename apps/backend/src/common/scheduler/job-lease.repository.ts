/**
 * Story IR.2b Task 3.2 (AD-10, AD-17): PostgreSQL is the only claim authority
 * of a scheduled job. One `scheduler_job_leases` row per job; a run holds it
 * with an owner, a lease expiry and a monotonically increasing fencing token.
 * Every renewal and completion is a compare-and-set on (owner, token), so a
 * runner whose lease was taken over can never record its outcome.
 */
export const JOB_LEASE_REPOSITORY = Symbol('JOB_LEASE_REPOSITORY');

export type JobRunStatus = 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'LEASE_LOST';

export interface AcquiredLease {
  /** BIGINT fencing token, as a string. */
  fencingToken: string;
  /** Failed runs in a row before this one (failure backoff). */
  consecutiveFailures: number;
}

export type AcquireResult =
  | { acquired: true; lease: AcquiredLease }
  /** NOT_DUE: next_run_at is later; HELD: another owner's lease is live. */
  | { acquired: false; reason: 'NOT_DUE' | 'HELD' };

export interface JobCompletion {
  status: JobRunStatus;
  nextRunAt: Date;
  consecutiveFailures: number;
  /** Counts only. */
  summary: Record<string, number> | null;
  error: string | null;
}

export interface JobLeaseRow {
  jobName: string;
  leaseOwner: string | null;
  fencingToken: string;
  leaseExpiresAt: Date | null;
  nextRunAt: Date;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastStatus: string | null;
  lastSummary: unknown;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface JobLeaseRepository {
  /** Creates missing rows (due at `now`); existing rows are untouched. */
  ensureJobs(names: string[], now: Date): Promise<void>;
  /**
   * Takes the lease when the job is due (or `ignoreSchedule`) and no live
   * lease exists; increments the fencing token.
   */
  tryAcquire(
    jobName: string,
    owner: string,
    now: Date,
    leaseTtlMs: number,
    ignoreSchedule?: boolean,
  ): Promise<AcquireResult>;
  /** Extends the lease; false when owner/token no longer match. */
  renew(
    jobName: string,
    owner: string,
    fencingToken: string,
    now: Date,
    leaseTtlMs: number,
  ): Promise<boolean>;
  /** Releases the lease and records the outcome; false when stale. */
  complete(
    jobName: string,
    owner: string,
    fencingToken: string,
    now: Date,
    completion: JobCompletion,
  ): Promise<boolean>;
  list(): Promise<JobLeaseRow[]>;
}

/** In-memory double (unit tests, in-memory e2e). Same semantics as SQL. */
export class InMemoryJobLeaseRepository implements JobLeaseRepository {
  readonly rows = new Map<string, JobLeaseRow>();

  async ensureJobs(names: string[], now: Date): Promise<void> {
    for (const name of names) {
      if (!this.rows.has(name)) {
        this.rows.set(name, {
          jobName: name,
          leaseOwner: null,
          fencingToken: '0',
          leaseExpiresAt: null,
          nextRunAt: now,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastStatus: null,
          lastSummary: null,
          lastError: null,
          consecutiveFailures: 0,
        });
      }
    }
  }

  async tryAcquire(
    jobName: string,
    owner: string,
    now: Date,
    leaseTtlMs: number,
    ignoreSchedule = false,
  ): Promise<AcquireResult> {
    const row = this.rows.get(jobName);
    if (!row) return { acquired: false, reason: 'NOT_DUE' };
    const held =
      row.leaseOwner !== null &&
      row.leaseExpiresAt !== null &&
      row.leaseExpiresAt.getTime() >= now.getTime();
    if (held) return { acquired: false, reason: 'HELD' };
    if (!ignoreSchedule && row.nextRunAt.getTime() > now.getTime()) {
      return { acquired: false, reason: 'NOT_DUE' };
    }
    row.leaseOwner = owner;
    row.fencingToken = String(BigInt(row.fencingToken) + 1n);
    row.leaseExpiresAt = new Date(now.getTime() + leaseTtlMs);
    row.lastStartedAt = now;
    return {
      acquired: true,
      lease: {
        fencingToken: row.fencingToken,
        consecutiveFailures: row.consecutiveFailures,
      },
    };
  }

  async renew(
    jobName: string,
    owner: string,
    fencingToken: string,
    now: Date,
    leaseTtlMs: number,
  ): Promise<boolean> {
    const row = this.rows.get(jobName);
    if (!row || row.leaseOwner !== owner || row.fencingToken !== fencingToken) {
      return false;
    }
    row.leaseExpiresAt = new Date(now.getTime() + leaseTtlMs);
    return true;
  }

  async complete(
    jobName: string,
    owner: string,
    fencingToken: string,
    now: Date,
    completion: JobCompletion,
  ): Promise<boolean> {
    const row = this.rows.get(jobName);
    if (!row || row.leaseOwner !== owner || row.fencingToken !== fencingToken) {
      return false;
    }
    row.leaseOwner = null;
    row.leaseExpiresAt = null;
    row.nextRunAt = completion.nextRunAt;
    row.lastFinishedAt = now;
    row.lastStatus = completion.status;
    row.lastSummary = completion.summary;
    row.lastError = completion.error;
    row.consecutiveFailures = completion.consecutiveFailures;
    return true;
  }

  async list(): Promise<JobLeaseRow[]> {
    return Array.from(this.rows.values()).map((row) => ({ ...row }));
  }
}
