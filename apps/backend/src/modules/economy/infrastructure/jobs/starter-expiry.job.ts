import {
  addCounts,
  assertNotAllFailed,
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
} from '../../../../common/scheduler/scheduled-job';
import {
  SCHEDULER_MAX_BATCHES_PER_RUN,
  STARTER_EXPIRY_JOB,
} from '../../../../common/scheduler/scheduler.constants';
import { StarterPointsCoordinator } from '../../application/starter-points.coordinator';

/**
 * Story IR.2b Task 7 (AC3, FR-5; closes Epic 6 DF2 and the Story 7.2
 * scheduler entry): the hourly starter-points expiry sweep, the same command
 * and semantics as `POST /economy/starter-points/expire` (default cutoff
 * now − 30 days, catch-up unlock for READY_TO_UNLOCK, deferral for
 * PENDING_CONFIRMATION, `WARNING` with dedupe = journal key). Nothing is kept
 * between runs; each run starts from the oldest registration. The summary is
 * counts only — never the expired / unlocked user ids.
 */
export class StarterExpiryJob implements ScheduledJob {
  readonly name = STARTER_EXPIRY_JOB.name;
  readonly intervalMs = STARTER_EXPIRY_JOB.intervalMs;
  readonly leaseTtlMs = STARTER_EXPIRY_JOB.leaseTtlMs;
  /**
   * Review LOW-7: resume point of the sweep (wraps at the end).
   * Limitation: per-process, like `PendingReleaseJob.cursor`.
   */
  private cursor: string | undefined;

  constructor(
    private readonly coordinator: Pick<
      StarterPointsCoordinator,
      'expireUnmaturedStarterPoints'
    >,
    private readonly maxBatches = SCHEDULER_MAX_BATCHES_PER_RUN,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    const counts: Record<string, number> = {
      scannedCount: 0,
      expiredCount: 0,
      unlockedCount: 0,
      deferredCount: 0,
      failedCount: 0,
      totalPointsVoided: 0,
    };
    let after = this.cursor;
    let hasMore = false;
    for (let batch = 0; batch < this.maxBatches; batch++) {
      if (batch > 0 && !(await ctx.shouldContinue())) break;
      const result = await this.coordinator.expireUnmaturedStarterPoints(
        undefined,
        { limit: STARTER_EXPIRY_JOB.batchSize, after },
      );
      addCounts(counts, {
        scannedCount: result.scannedCount,
        expiredCount: result.expiredCount,
        unlockedCount: result.unlockedUserIds.length,
        deferredCount: result.deferredCount,
        failedCount: result.failedCount,
        totalPointsVoided: result.totalPointsVoided,
      });
      hasMore = result.nextCursor !== null;
      after = result.nextCursor ?? undefined;
      if (!hasMore) break;
    }
    this.cursor = after;
    assertNotAllFailed(this.name, counts.failedCount, counts.scannedCount);
    return {
      status: counts.failedCount > 0 ? 'PARTIAL' : 'SUCCEEDED',
      counts,
      hasMore,
    };
  }
}
