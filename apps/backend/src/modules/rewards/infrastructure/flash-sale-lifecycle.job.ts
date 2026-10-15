import {
  addCounts,
  assertNotAllFailed,
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
} from '../../../common/scheduler/scheduled-job';
import {
  FLASH_SALE_LIFECYCLE_JOB,
  SCHEDULER_MAX_BATCHES_PER_RUN,
} from '../../../common/scheduler/scheduler.constants';
import { FlashSaleLifecycleService } from '../application/flash-sale-lifecycle.service';

export class FlashSaleLifecycleJob implements ScheduledJob {
  readonly name = FLASH_SALE_LIFECYCLE_JOB.name;
  readonly intervalMs = FLASH_SALE_LIFECYCLE_JOB.intervalMs;
  readonly leaseTtlMs = FLASH_SALE_LIFECYCLE_JOB.leaseTtlMs;

  constructor(
    private readonly lifecycle: Pick<FlashSaleLifecycleService, 'runDue'>,
    private readonly maxBatches = SCHEDULER_MAX_BATCHES_PER_RUN,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    const counts = {
      settledCount: 0,
      reservedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
    let hasMore = false;
    for (let batch = 0; batch < this.maxBatches; batch++) {
      if (batch > 0 && !(await ctx.shouldContinue())) break;
      const result = await this.lifecycle.runDue(
        ctx.now,
        FLASH_SALE_LIFECYCLE_JOB.batchSize,
        ctx.logger,
      );
      // A reservation failure is an expected, handled outcome (sale cancelled
      // + alert): counted as skipped, not as a job failure.
      addCounts(counts, {
        settledCount: result.settled,
        reservedCount: result.reserved,
        skippedCount: result.reservationFailed,
        failedCount: result.errored,
      });
      hasMore =
        result.settled + result.reserved + result.reservationFailed >=
        FLASH_SALE_LIFECYCLE_JOB.batchSize;
      if (!hasMore) break;
    }
    const totalAttempted =
      counts.settledCount +
      counts.reservedCount +
      counts.skippedCount +
      counts.failedCount;
    assertNotAllFailed(this.name, counts.failedCount, totalAttempted);
    return {
      status: counts.failedCount > 0 ? 'PARTIAL' : 'SUCCEEDED',
      counts,
      hasMore,
    };
  }
}
