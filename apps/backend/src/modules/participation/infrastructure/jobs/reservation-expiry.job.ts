import { RESERVATION_EXPIRY_MS } from '@rescom/schemas';
import {
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
} from '../../../../common/scheduler/scheduled-job';
import {
  RESERVATION_EXPIRY_JOB,
  RESERVATION_GRACE_MS,
  SCHEDULER_MAX_BATCHES_PER_RUN,
} from '../../../../common/scheduler/scheduler.constants';
import { ParticipationRepositoryPort } from '../../application/ports/participation-repository.port';

/**
 * Story IR.2b Task 8.5 (AC4; closes Epic 5 DF7): closes attempts whose
 * 30-minute reservation passed (+ 2 min grace, so the service already
 * refuses them) as ABANDONED / EXPIRED. The quota slot was already released
 * by the time window, so quota numbers do not change; the durable effect is
 * the state transition. Loses cleanly to a submit or verification that holds
 * the attempt row (`FOR UPDATE SKIP LOCKED` + conditional update). Internal
 * Responses move to ABANDONED in the same statement.
 */
export class ReservationExpiryJob implements ScheduledJob {
  readonly name = RESERVATION_EXPIRY_JOB.name;
  readonly intervalMs = RESERVATION_EXPIRY_JOB.intervalMs;
  readonly leaseTtlMs = RESERVATION_EXPIRY_JOB.leaseTtlMs;

  constructor(
    private readonly participationRepository: Pick<
      ParticipationRepositoryPort,
      'abandonExpiredAttemptsBatch'
    >,
    private readonly maxBatches = SCHEDULER_MAX_BATCHES_PER_RUN,
  ) {}

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    const cutoff = new Date(
      ctx.now.getTime() - RESERVATION_EXPIRY_MS - RESERVATION_GRACE_MS,
    );
    let abandonedCount = 0;
    let hasMore = false;
    for (let batch = 0; batch < this.maxBatches; batch++) {
      if (batch > 0 && !(await ctx.shouldContinue())) break;
      const { abandonedIds } =
        await this.participationRepository.abandonExpiredAttemptsBatch(
          cutoff,
          RESERVATION_EXPIRY_JOB.batchSize,
          ctx.now,
        );
      abandonedCount += abandonedIds.length;
      hasMore = abandonedIds.length === RESERVATION_EXPIRY_JOB.batchSize;
      if (!hasMore) break;
    }
    return { status: 'SUCCEEDED', counts: { abandonedCount }, hasMore };
  }
}
