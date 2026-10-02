import { UnitOfWorkPort } from '../../database/unit-of-work.port';
import { Clock } from '../../time/clock';
import { JobRunContext, JobRunSummary, ScheduledJob } from '../scheduled-job';
import {
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_JITTER,
  OUTBOX_BACKOFF_MAX_MS,
  OUTBOX_CLAIM_LEASE_MS,
  OUTBOX_DISPATCH_JOB,
  OUTBOX_LAST_ERROR_MAX_LENGTH,
} from '../scheduler.constants';
import {
  OutboxClaimRepository,
  OutboxFailure,
} from './outbox-claim.repository';
import { safeErrorCode } from '../safe-error';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxHandlerRegistry,
  OutboxPayloadInvalidError,
} from './outbox-handler';

/**
 * Retry delay after the `attempts`-th failed delivery: 30 s · 2^(attempts−1),
 * capped at 1 h, ±20 % jitter (`random` ∈ [0, 1)).
 */
export function outboxBackoffMs(
  attempts: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(
    OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    OUTBOX_BACKOFF_MAX_MS,
  );
  const jitter = (random() * 2 - 1) * OUTBOX_BACKOFF_JITTER;
  return Math.max(0, Math.round(base * (1 + jitter)));
}

/** A newer claimant owns the event: abort without effect. */
class StaleClaimError extends Error {
  constructor() {
    super('Outbox claim no longer held');
    this.name = 'StaleClaimError';
  }
}

export interface OutboxDispatchOptions {
  intervalMs: number;
  maxAttempts: number;
  random?: () => number;
}

type EventOutcome = 'PROCESSED' | 'RETRY' | 'DEAD_LETTER' | 'STALE';

/**
 * Story IR.2b Task 4.4–4.6 (AD-10): the Outbox dispatcher, itself a scheduled
 * job (`outbox-dispatch`, every tick, lease 60 s, 20 events × at most 10
 * batches per run). It claims only subscribed event types and never marks an
 * event PROCESSED without its handlers. Per event and per handler without a
 * `processed_handlers` row, one short Unit of Work: re-check the claim
 * (`FOR UPDATE`, CAS owner + token) → handler effect → `processed_handlers`
 * row → PROCESSED when it was the last handler. A failure is recorded in a
 * separate short write (retry with backoff, or dead letter).
 */
export class OutboxDispatchJob implements ScheduledJob {
  readonly name = OUTBOX_DISPATCH_JOB.name;
  readonly leaseTtlMs = OUTBOX_DISPATCH_JOB.leaseTtlMs;
  readonly intervalMs: number;
  private batchCounter = 0;

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly claims: OutboxClaimRepository,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly clock: Clock,
    private readonly options: OutboxDispatchOptions,
  ) {
    this.intervalMs = options.intervalMs;
  }

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    const counts = {
      claimed: 0,
      processed: 0,
      retried: 0,
      deadLettered: 0,
      staleClaims: 0,
    };
    const types = this.registry.subscribedEventTypes();
    let hasMore = false;
    for (let batch = 0; batch < OUTBOX_DISPATCH_JOB.maxBatches; batch++) {
      if (batch > 0 && !(await ctx.shouldContinue())) break;
      // Unique per claim batch and increasing across lease epochs; the
      // column is TEXT and only equality is compared.
      const fencingToken = `${ctx.fencingToken}.${++this.batchCounter}`;
      const events = await this.claims.claimBatch({
        types,
        owner: ctx.owner,
        fencingToken,
        now: this.clock.now(),
        leaseMs: OUTBOX_CLAIM_LEASE_MS,
        limit: OUTBOX_DISPATCH_JOB.batchSize,
      });
      counts.claimed += events.length;
      let stopped = false;
      for (const [index, event] of events.entries()) {
        // Review MEDIUM-2/3: renew the job lease per event and honour a
        // graceful stop inside a batch; unstarted claims are handed back.
        if (index > 0 && !(await ctx.shouldContinue())) {
          stopped = true;
          for (const rest of events.slice(index)) {
            await this.claims
              .releaseClaim(rest.id, ctx.owner, fencingToken)
              .catch(() => undefined);
          }
          break;
        }
        let outcome: EventOutcome;
        try {
          outcome = await this.dispatch(event, ctx, fencingToken);
        } catch (error) {
          // A failure outside a handler (e.g. a DB read) aborts the run: hand
          // the unstarted claims back instead of stranding them until the
          // claim lease expires (review 2026-10-01).
          for (const rest of events.slice(index + 1)) {
            await this.claims
              .releaseClaim(rest.id, ctx.owner, fencingToken)
              .catch(() => undefined);
          }
          throw error;
        }
        if (outcome === 'PROCESSED') counts.processed++;
        else if (outcome === 'RETRY') counts.retried++;
        else if (outcome === 'DEAD_LETTER') counts.deadLettered++;
        else counts.staleClaims++;
      }
      hasMore = stopped || events.length === OUTBOX_DISPATCH_JOB.batchSize;
      if (!hasMore || stopped) break;
    }
    return {
      status:
        counts.retried + counts.deadLettered + counts.staleClaims > 0
          ? 'PARTIAL'
          : 'SUCCEEDED',
      counts,
      hasMore,
    };
  }

  private async dispatch(
    event: OutboxEnvelope,
    ctx: JobRunContext,
    fencingToken: string,
  ): Promise<EventOutcome> {
    const handlers = this.registry.handlersFor(event.eventType);
    const unsupported = handlers.find(
      (handler) => !handler.schemaVersions.includes(event.schemaVersion),
    );
    if (unsupported) {
      return this.fail(event, ctx, fencingToken, unsupported, {
        deadLetter: 'UNSUPPORTED_SCHEMA_VERSION',
        message: `unsupported schema version ${event.schemaVersion}`,
      });
    }

    const done = await this.claims.processedHandlerNames(event.id);
    const pending = handlers.filter((handler) => !done.has(handler.name));
    if (pending.length === 0) {
      // Every handler already ran (a crash after the last handler's commit
      // is impossible: PROCESSED commits with it), so only the state is left.
      return this.settle(event, ctx, fencingToken, null);
    }

    for (let index = 0; index < pending.length; index++) {
      const handler = pending[index];
      const outcome = await this.settle(
        event,
        ctx,
        fencingToken,
        handler,
        index === pending.length - 1,
      );
      if (outcome !== 'PROCESSED') return outcome;
    }
    return 'PROCESSED';
  }

  /** One handler (or the final state only) in one short Unit of Work. */
  private async settle(
    event: OutboxEnvelope,
    ctx: JobRunContext,
    fencingToken: string,
    handler: OutboxHandler | null,
    isLast = true,
  ): Promise<EventOutcome> {
    try {
      // Review MEDIUM-2: a kind-(b) handler (external effect) runs with no
      // ambient transaction, after an unlocked claim check; only the
      // bookkeeping below is transactional.
      const outside = handler?.runsOutsideTransaction === true;
      if (outside) {
        if (
          !(await this.claims.lockClaimed(event.id, ctx.owner, fencingToken))
        ) {
          throw new StaleClaimError();
        }
        await handler.handle(event);
      }
      await this.unitOfWork.run(
        `outbox:${event.id}:${handler?.name ?? 'state'}`,
        async () => {
          if (
            !(await this.claims.lockClaimed(event.id, ctx.owner, fencingToken))
          ) {
            throw new StaleClaimError();
          }
          const now = this.clock.now();
          if (handler) {
            if (!outside) await handler.handle(event);
            await this.claims.recordProcessed(
              handler.name,
              event.id,
              event.streamSequence,
              now,
            );
          }
          if (isLast) {
            await this.claims.markProcessed(event.id, now);
          }
        },
      );
    } catch (error) {
      if (error instanceof StaleClaimError) {
        ctx.logger.warn(
          `OUTBOX_STALE_CLAIM ${this.describe(event, handler, fencingToken)}`,
        );
        return 'STALE';
      }
      return this.fail(event, ctx, fencingToken, handler, { error });
    }
    if (isLast) {
      ctx.logger.log(`OUTBOX_DISPATCHED ${this.describe(event, handler)}`);
    }
    return 'PROCESSED';
  }

  private async fail(
    event: OutboxEnvelope,
    ctx: JobRunContext,
    fencingToken: string,
    handler: OutboxHandler | null,
    cause: { error?: unknown; deadLetter?: string; message?: string },
  ): Promise<EventOutcome> {
    const now = this.clock.now();
    const error = cause.error;
    // Review LOW-10: class + stable code only, never the raw message.
    const message = cause.message ?? safeErrorCode(error);
    let terminalState: string | null = cause.deadLetter ?? null;
    if (!terminalState) {
      if (error instanceof OutboxPayloadInvalidError) {
        terminalState = 'INVALID_PAYLOAD';
      } else if (handler?.isRetryable && !handler.isRetryable(error)) {
        terminalState = 'NON_RETRYABLE';
      } else if (event.attempts >= this.options.maxAttempts) {
        terminalState = 'MAX_ATTEMPTS';
      }
    }
    const failure: OutboxFailure = terminalState
      ? {
          status: 'DEAD_LETTER',
          availableAt: now,
          lastError: truncate(`${handler?.name ?? 'dispatcher'}: ${message}`),
          terminalState,
        }
      : {
          status: 'FAILED',
          availableAt: new Date(
            now.getTime() +
              outboxBackoffMs(event.attempts, this.options.random),
          ),
          lastError: truncate(`${handler?.name ?? 'dispatcher'}: ${message}`),
          terminalState: null,
        };
    const recorded = await this.claims
      .recordFailure(event.id, ctx.owner, fencingToken, now, failure)
      .catch(() => false);
    if (!recorded) {
      ctx.logger.warn(
        `OUTBOX_STALE_CLAIM ${this.describe(event, handler, fencingToken)}`,
      );
      return 'STALE';
    }
    if (failure.status === 'DEAD_LETTER') {
      ctx.logger.error(
        `OUTBOX_DEAD_LETTERED ${this.describe(event, handler)} ${JSON.stringify({ terminalState })}`,
      );
      return 'DEAD_LETTER';
    }
    ctx.logger.warn(
      `OUTBOX_RETRY_SCHEDULED ${this.describe(event, handler)} ${JSON.stringify({ availableAt: failure.availableAt.toISOString() })}`,
    );
    return 'RETRY';
  }

  /** Correlation fields only — never the payload (AD-18). */
  private describe(
    event: OutboxEnvelope,
    handler: OutboxHandler | null,
    fencingToken?: string,
  ): string {
    return JSON.stringify({
      correlationId: event.correlationId ?? event.id,
      eventId: event.id,
      eventType: event.eventType,
      handler: handler?.name ?? null,
      attempts: event.attempts,
      ...(fencingToken ? { fencingToken } : {}),
    });
  }
}

function truncate(value: string): string {
  return value.length > OUTBOX_LAST_ERROR_MAX_LENGTH
    ? value.slice(0, OUTBOX_LAST_ERROR_MAX_LENGTH)
    : value;
}
