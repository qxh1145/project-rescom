import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  AcquireResult,
  JobCompletion,
  JobLeaseRepository,
  JobLeaseRow,
} from './job-lease.repository';

/**
 * Story IR.2b Task 3.2. Every statement takes `$now` from the injected clock
 * (never SQL `now()`), so tests control time; this assumes one host clock
 * (single VM, NTP). Always the base client: a lease is never part of a job's
 * own Unit of Work. BIGINT values cross the boundary as strings.
 */
@Injectable()
export class PrismaJobLeaseRepository implements JobLeaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ensureJobs(names: string[], now: Date): Promise<void> {
    if (names.length === 0) return;
    await this.prisma.$executeRaw`
      INSERT INTO scheduler_job_leases (job_name, next_run_at, created_at, updated_at)
      SELECT name, ${now}, ${now}, ${now} FROM unnest(${names}::text[]) AS name
      ON CONFLICT (job_name) DO NOTHING
    `;
  }

  async tryAcquire(
    jobName: string,
    owner: string,
    now: Date,
    leaseTtlMs: number,
    ignoreSchedule = false,
  ): Promise<AcquireResult> {
    const expiresAt = new Date(now.getTime() + leaseTtlMs);
    const rows = await this.prisma.$queryRaw<
      Array<{ fencingToken: string; consecutiveFailures: number }>
    >`
      UPDATE scheduler_job_leases
         SET lease_owner = ${owner},
             fencing_token = fencing_token + 1,
             lease_expires_at = ${expiresAt},
             last_started_at = ${now},
             updated_at = ${now}
       WHERE job_name = ${jobName}
         AND (${ignoreSchedule} OR next_run_at <= ${now})
         AND (lease_owner IS NULL OR lease_expires_at < ${now})
      RETURNING fencing_token::text AS "fencingToken",
                consecutive_failures AS "consecutiveFailures"
    `;
    const row = rows[0];
    if (row) {
      return {
        acquired: true,
        lease: {
          fencingToken: row.fencingToken,
          consecutiveFailures: Number(row.consecutiveFailures),
        },
      };
    }
    const held = await this.prisma.$queryRaw<Array<{ held: boolean }>>`
      SELECT (lease_owner IS NOT NULL AND lease_expires_at >= ${now}) AS held
      FROM scheduler_job_leases WHERE job_name = ${jobName}
    `;
    return { acquired: false, reason: held[0]?.held ? 'HELD' : 'NOT_DUE' };
  }

  async renew(
    jobName: string,
    owner: string,
    fencingToken: string,
    now: Date,
    leaseTtlMs: number,
  ): Promise<boolean> {
    const expiresAt = new Date(now.getTime() + leaseTtlMs);
    const count = await this.prisma.$executeRaw`
      UPDATE scheduler_job_leases
         SET lease_expires_at = ${expiresAt}, updated_at = ${now}
       WHERE job_name = ${jobName}
         AND lease_owner = ${owner}
         AND fencing_token = ${fencingToken}::bigint
    `;
    return count === 1;
  }

  async complete(
    jobName: string,
    owner: string,
    fencingToken: string,
    now: Date,
    completion: JobCompletion,
  ): Promise<boolean> {
    const summary =
      completion.summary === null
        ? Prisma.sql`NULL`
        : Prisma.sql`${JSON.stringify(completion.summary)}::jsonb`;
    const count = await this.prisma.$executeRaw`
      UPDATE scheduler_job_leases
         SET lease_owner = NULL,
             lease_expires_at = NULL,
             next_run_at = ${completion.nextRunAt},
             last_finished_at = ${now},
             last_status = ${completion.status},
             last_summary = ${summary},
             last_error = ${completion.error},
             consecutive_failures = ${completion.consecutiveFailures},
             updated_at = ${now}
       WHERE job_name = ${jobName}
         AND lease_owner = ${owner}
         AND fencing_token = ${fencingToken}::bigint
    `;
    return count === 1;
  }

  async list(): Promise<JobLeaseRow[]> {
    const rows = await this.prisma.schedulerJobLease.findMany({
      orderBy: { jobName: 'asc' },
    });
    return rows.map((row) => ({
      jobName: row.jobName,
      leaseOwner: row.leaseOwner,
      fencingToken: row.fencingToken.toString(),
      leaseExpiresAt: row.leaseExpiresAt,
      nextRunAt: row.nextRunAt,
      lastStartedAt: row.lastStartedAt,
      lastFinishedAt: row.lastFinishedAt,
      lastStatus: row.lastStatus,
      lastSummary: row.lastSummary,
      lastError: row.lastError,
      consecutiveFailures: row.consecutiveFailures,
    }));
  }
}
