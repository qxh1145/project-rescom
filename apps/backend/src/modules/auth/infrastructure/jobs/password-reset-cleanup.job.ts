import {
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
} from '../../../../common/scheduler/scheduled-job';
import { SCHEDULER_MAX_BATCHES_PER_RUN } from '../../../../common/scheduler/scheduler.constants';
import { PasswordResetRepositoryPort } from '../../application/ports/password-reset.repository.port';

const HOUR_MS = 60 * 60 * 1000;

export const PASSWORD_RESET_CLEANUP_JOB = {
  name: 'password-reset-cleanup',
  intervalMs: 6 * HOUR_MS,
  leaseTtlMs: 10 * 60 * 1000,
  batchSize: 500,
  /** Used or expired tokens are kept this long (audit context), then deleted. */
  retentionMs: 7 * 24 * HOUR_MS,
} as const;

/**
 * Review L9 (plan 5.4): deletes `password_reset_tokens` used or expired more
 * than 7 days ago, in bounded batches. Counts only in the summary.
 */
export class PasswordResetCleanupJob implements ScheduledJob {
  readonly name = PASSWORD_RESET_CLEANUP_JOB.name;
  readonly intervalMs = PASSWORD_RESET_CLEANUP_JOB.intervalMs;
  readonly leaseTtlMs = PASSWORD_RESET_CLEANUP_JOB.leaseTtlMs;

  constructor(
    private readonly resets: Pick<PasswordResetRepositoryPort, 'purgeBefore'>,
    private readonly maxBatches = SCHEDULER_MAX_BATCHES_PER_RUN,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    const cutoff = new Date(
      ctx.now.getTime() - PASSWORD_RESET_CLEANUP_JOB.retentionMs,
    );
    let deletedCount = 0;
    let hasMore = false;
    for (let batch = 0; batch < this.maxBatches; batch++) {
      if (batch > 0 && !(await ctx.shouldContinue())) break;
      const deleted = await this.resets.purgeBefore(
        cutoff,
        PASSWORD_RESET_CLEANUP_JOB.batchSize,
      );
      deletedCount += deleted;
      hasMore = deleted === PASSWORD_RESET_CLEANUP_JOB.batchSize;
      if (!hasMore) break;
    }
    return { status: 'SUCCEEDED', counts: { deletedCount }, hasMore };
  }
}
