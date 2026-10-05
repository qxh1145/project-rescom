import {
  addCounts,
  assertNotAllFailed,
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
} from '../../../../common/scheduler/scheduled-job';
import {
  PENDING_RELEASE_JOB,
  SCHEDULER_MAX_BATCHES_PER_RUN,
} from '../../../../common/scheduler/scheduler.constants';
import { RewardSettlementCoordinator } from '../../application/reward-settlement.coordinator';

/**
 * Story IR.2b Task 6 (AC2, FR-24, NFR-13; closes Epic 6 DF1): releases
 * External credits whose 48-hour Pending window elapsed, through the existing
 * idempotent command (`release-pending:{attemptId}`, one `REWARD_RELEASED`).
 * Pages with the keyset cursor so persistently failing credits cannot starve
 * newer ones; each run starts from the oldest again, so failures are retried
 * once per run. The Admin endpoint stays the operator fallback.
 */
export class PendingReleaseJob implements ScheduledJob {
  readonly name = PENDING_RELEASE_JOB.name;
  readonly intervalMs = PENDING_RELEASE_JOB.intervalMs;
  readonly leaseTtlMs = PENDING_RELEASE_JOB.leaseTtlMs;
  /**
   * Review LOW-7: where the last run stopped, so a backlog larger than one
   * run's budget is swept to the end before the scan wraps to the oldest.
   * Limitation: per-process; a restart (or a lease moving to another process)
   * rescans from the oldest credit. Persist it in the lease row if that
   * ever starves a backlog.
   */
  private cursor: string | undefined;

  constructor(
    private readonly coordinator: Pick<
      RewardSettlementCoordinator,
      'releaseMaturedPendingRewards'
    >,
    private readonly maxBatches = SCHEDULER_MAX_BATCHES_PER_RUN,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    const counts: Record<string, number> = {
      processed: 0,
      releasedCount: 0,
      disputedCount: 0,
      failedCount: 0,
    };
    let after = this.cursor;
    let hasMore = false;
    for (let batch = 0; batch < this.maxBatches; batch++) {
      if (batch > 0 && !(await ctx.shouldContinue())) break;
      const result = await this.coordinator.releaseMaturedPendingRewards({
        limit: PENDING_RELEASE_JOB.batchSize,
        after,
      });
      addCounts(counts, {
        processed: result.processed,
        releasedCount: result.releasedCount,
        disputedCount: result.disputedCount,
        failedCount: result.failedCount,
      });
      hasMore = result.hasMore && result.nextCursor !== null;
      // At the end: wrap, the next run starts from the oldest credit again.
      after = hasMore ? (result.nextCursor ?? undefined) : undefined;
      if (!hasMore) break;
    }
    this.cursor = after;
    assertNotAllFailed(this.name, counts.failedCount, counts.processed);
    return {
      status: counts.failedCount > 0 ? 'PARTIAL' : 'SUCCEEDED',
      counts,
      hasMore,
    };
  }
}
