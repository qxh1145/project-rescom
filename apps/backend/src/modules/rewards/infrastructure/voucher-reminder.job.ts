import {
  addCounts,
  assertNotAllFailed,
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
} from '../../../common/scheduler/scheduled-job';
import {
  VOUCHER_REMINDER_JOB,
  SCHEDULER_MAX_BATCHES_PER_RUN,
} from '../../../common/scheduler/scheduler.constants';
import { VoucherReminderService } from '../application/voucher-reminder.service';

export class VoucherReminderJob implements ScheduledJob {
  readonly name = VOUCHER_REMINDER_JOB.name;
  readonly intervalMs = VOUCHER_REMINDER_JOB.intervalMs;
  readonly leaseTtlMs = VOUCHER_REMINDER_JOB.leaseTtlMs;

  constructor(
    private readonly reminderService: Pick<VoucherReminderService, 'runDue'>,
    private readonly maxBatches = SCHEDULER_MAX_BATCHES_PER_RUN,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    const counts = {
      emittedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
    let hasMore = false;
    for (let batch = 0; batch < this.maxBatches; batch++) {
      if (batch > 0 && !(await ctx.shouldContinue())) break;
      const result = await this.reminderService.runDue(
        ctx.now,
        VOUCHER_REMINDER_JOB.batchSize,
        ctx.logger,
      );
      addCounts(counts, {
        emittedCount: result.emitted,
        skippedCount: result.skipped,
        failedCount: result.errored,
      });
      hasMore =
        result.emitted + result.skipped + result.errored >=
        VOUCHER_REMINDER_JOB.batchSize;
      if (!hasMore) break;
    }
    const totalAttempted =
      counts.emittedCount + counts.skippedCount + counts.failedCount;
    assertNotAllFailed(this.name, counts.failedCount, totalAttempted);
    return {
      status: counts.failedCount > 0 ? 'PARTIAL' : 'SUCCEEDED',
      counts,
      hasMore,
    };
  }
}
