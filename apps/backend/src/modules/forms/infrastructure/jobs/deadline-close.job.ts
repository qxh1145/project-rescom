import {
  assertNotAllFailed,
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
} from '../../../../common/scheduler/scheduled-job';
import {
  DEADLINE_CLOSE_JOB,
  SCHEDULER_MAX_BATCHES_PER_RUN,
} from '../../../../common/scheduler/scheduler.constants';
import {
  DEADLINE_CLOSE_GRACE_MS,
  FormsService,
} from '../../application/forms.service';
import { FormRepositoryPort } from '../../application/ports/form-repository.port';

/**
 * Story IR.2b Task 9.6 (AC5; closes Epic 6 DF6): closes PUBLISHED / queued
 * surveys whose deadline passed more than one reservation window + 2 min ago
 * and refunds their leftover Escrow, one form per Unit of Work, through
 * `FormsService.closeFormAtDeadline` (the AD-16 coordinator stays inside
 * Research). Safe to run twice: the close is an optimistic transition and
 * the refund key `close-refund:{formId}:c{n}` is unique.
 */
export class DeadlineCloseJob implements ScheduledJob {
  readonly name = DEADLINE_CLOSE_JOB.name;
  readonly intervalMs = DEADLINE_CLOSE_JOB.intervalMs;
  readonly leaseTtlMs = DEADLINE_CLOSE_JOB.leaseTtlMs;

  constructor(
    private readonly forms: Pick<FormsService, 'closeFormAtDeadline'>,
    private readonly formRepository: Pick<
      FormRepositoryPort,
      'findFormsPastDeadline'
    >,
    private readonly maxBatches = SCHEDULER_MAX_BATCHES_PER_RUN,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    const counts = {
      closedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      pointsRefunded: 0,
    };
    const cutoff = new Date(ctx.now.getTime() - DEADLINE_CLOSE_GRACE_MS);
    // A form that failed (or lost a race) is still due; it is tried once per
    // run, so a stuck form cannot loop the run.
    const attempted = new Set<string>();
    let hasMore = false;
    for (let batch = 0; batch < this.maxBatches; batch++) {
      if (batch > 0 && !(await ctx.shouldContinue())) break;
      const ids = await this.formRepository.findFormsPastDeadline(
        cutoff,
        DEADLINE_CLOSE_JOB.batchSize + attempted.size,
      );
      const fresh = ids.filter((id) => !attempted.has(id));
      if (fresh.length === 0) {
        hasMore = false;
        break;
      }
      for (const formId of fresh.slice(0, DEADLINE_CLOSE_JOB.batchSize)) {
        attempted.add(formId);
        try {
          const result = await this.forms.closeFormAtDeadline(formId, ctx.now);
          if (result.closed) {
            counts.closedCount++;
            counts.pointsRefunded += result.refundAmount;
          } else {
            counts.skippedCount++;
          }
        } catch (error) {
          counts.failedCount++;
          ctx.logger.warn(
            `Deadline close failed for one form; the next run retries it (${error instanceof Error ? error.name : 'UnknownError'}).`,
          );
        }
      }
      hasMore = fresh.length > DEADLINE_CLOSE_JOB.batchSize;
      if (!hasMore) break;
    }
    assertNotAllFailed(this.name, counts.failedCount, attempted.size);
    return {
      status: counts.failedCount > 0 ? 'PARTIAL' : 'SUCCEEDED',
      counts,
      hasMore,
    };
  }
}
