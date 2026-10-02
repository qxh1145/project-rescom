import { PassThroughUnitOfWork } from '../../database/unit-of-work.port';
import { FixedClock } from '../../time/clock';
import { JobRunContext } from '../scheduled-job';
import {
  DeadLetterPage,
  OutboxBacklog,
  OutboxClaimRepository,
  OutboxFailure,
  RedriveResult,
} from './outbox-claim.repository';
import { OutboxDispatchJob, outboxBackoffMs } from './outbox-dispatch.job';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxHandlerRegistry,
  OutboxPayloadInvalidError,
} from './outbox-handler';

interface Row extends OutboxEnvelope {
  status: 'PENDING' | 'FAILED' | 'PROCESSED' | 'DEAD_LETTER';
  availableAt: Date;
  claimOwner: string | null;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  lastError: string | null;
  terminalState: string | null;
}

/** In-memory double with the claim semantics of the SQL (unit tests only). */
class InMemoryOutboxClaims implements OutboxClaimRepository {
  rows: Row[] = [];
  processed: Array<{ handler: string; eventId: string }> = [];

  add(partial: Partial<Row> & { eventType: string; payload?: unknown }): Row {
    const id = `00000000-0000-4000-8000-${String(this.rows.length + 1).padStart(12, '0')}`;
    const row: Row = {
      id,
      idempotencyKey: `${partial.eventType}:${id}`,
      schemaVersion: 1,
      producer: 'test',
      aggregateType: 'Response',
      aggregateId: id,
      aggregateVersion: 1,
      orderingStream: null,
      streamSequence: null,
      correlationId: null,
      causationId: null,
      payload: {},
      attempts: 0,
      createdAt: new Date(0),
      status: 'PENDING',
      availableAt: new Date(0),
      claimOwner: null,
      claimToken: null,
      claimExpiresAt: null,
      lastError: null,
      terminalState: null,
      ...partial,
    };
    this.rows.push(row);
    return row;
  }

  async claimBatch(params: {
    types: string[];
    owner: string;
    fencingToken: string;
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<OutboxEnvelope[]> {
    const due = this.rows.filter(
      (row) =>
        params.types.includes(row.eventType) &&
        (row.status === 'PENDING' || row.status === 'FAILED') &&
        row.availableAt <= params.now &&
        (!row.claimExpiresAt || row.claimExpiresAt < params.now) &&
        (row.orderingStream === null ||
          !this.rows.some(
            (p) =>
              p.orderingStream === row.orderingStream &&
              (p.streamSequence ?? 0) < (row.streamSequence ?? 0) &&
              p.status !== 'PROCESSED',
          )),
    );
    return due.slice(0, params.limit).map((row) => {
      row.claimOwner = params.owner;
      row.claimToken = params.fencingToken;
      row.claimExpiresAt = new Date(params.now.getTime() + params.leaseMs);
      row.attempts += 1;
      return { ...row };
    });
  }

  async lockClaimed(id: string, owner: string, token: string) {
    const row = this.rows.find((r) => r.id === id);
    return row?.claimOwner === owner && row.claimToken === token;
  }

  async processedHandlerNames(eventId: string) {
    return new Set(
      this.processed.filter((p) => p.eventId === eventId).map((p) => p.handler),
    );
  }

  async recordProcessed(handler: string, eventId: string) {
    this.processed.push({ handler, eventId });
  }

  async markProcessed(eventId: string) {
    const row = this.rows.find((r) => r.id === eventId)!;
    Object.assign(row, {
      status: 'PROCESSED',
      claimOwner: null,
      claimToken: null,
      claimExpiresAt: null,
      lastError: null,
    });
  }

  async releaseClaim(id: string, owner: string, token: string) {
    const row = this.rows.find((r) => r.id === id)!;
    if (row.claimOwner !== owner || row.claimToken !== token) return;
    Object.assign(row, {
      claimOwner: null,
      claimToken: null,
      claimExpiresAt: null,
      attempts: Math.max(0, row.attempts - 1),
    });
  }

  async recordFailure(
    eventId: string,
    owner: string,
    token: string,
    _now: Date,
    failure: OutboxFailure,
  ) {
    const row = this.rows.find((r) => r.id === eventId)!;
    if (row.claimOwner !== owner || row.claimToken !== token) return false;
    Object.assign(row, {
      status: failure.status,
      availableAt: failure.availableAt,
      lastError: failure.lastError,
      terminalState: failure.terminalState,
      claimOwner: null,
      claimToken: null,
      claimExpiresAt: null,
    });
    return true;
  }

  async backlog(): Promise<OutboxBacklog> {
    throw new Error('not used');
  }
  async listDeadLetters(): Promise<DeadLetterPage> {
    throw new Error('not used');
  }
  async redrive(): Promise<RedriveResult> {
    throw new Error('not used');
  }
}

function context(): JobRunContext {
  return {
    runId: 'run-1',
    now: new Date(),
    owner: 'owner-a',
    fencingToken: '7',
    shouldContinue: async () => true,
    logger: { log() {}, warn() {}, error() {}, debug() {} },
  };
}

describe('OutboxDispatchJob (Story IR.2b Task 4, AC6)', () => {
  let clock: FixedClock;
  let claims: InMemoryOutboxClaims;
  let registry: OutboxHandlerRegistry;
  let handled: OutboxEnvelope[];
  let behaviour: (event: OutboxEnvelope) => Promise<void>;

  const handler: OutboxHandler = {
    name: 'test.reward',
    eventType: 'InternalRewardRequested',
    schemaVersions: [1],
    handle: (event) => behaviour(event),
  };

  function job(maxAttempts = 3): OutboxDispatchJob {
    return new OutboxDispatchJob(
      registry,
      claims,
      new PassThroughUnitOfWork(),
      clock,
      { intervalMs: 15_000, maxAttempts, random: () => 0.5 },
    );
  }

  beforeEach(() => {
    clock = new FixedClock(new Date('2026-10-01T00:00:00.000Z'));
    claims = new InMemoryOutboxClaims();
    registry = new OutboxHandlerRegistry();
    registry.register(handler);
    handled = [];
    behaviour = async (event) => {
      handled.push(event);
    };
  });

  it('dispatches subscribed events once and records the processed handler', async () => {
    const event = claims.add({ eventType: 'InternalRewardRequested' });

    const summary = await job().run(context());

    expect(summary).toMatchObject({
      status: 'SUCCEEDED',
      counts: { claimed: 1, processed: 1 },
    });
    expect(handled.map((e) => e.id)).toEqual([event.id]);
    expect(event.status).toBe('PROCESSED');
    expect(claims.processed).toEqual([
      { handler: 'test.reward', eventId: event.id },
    ]);

    // Replay: nothing is claimed again.
    await job().run(context());
    expect(handled).toHaveLength(1);
  });

  it('T8: never claims unsubscribed types (they stay PENDING, attempts 0)', async () => {
    const other = claims.add({ eventType: 'IntegrityAssessmentRequested' });
    await job().run(context());
    expect(other).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(registry.subscribedEventTypes()).toEqual([
      'InternalRewardRequested',
    ]);
  });

  it('T7: retries with backoff, then dead-letters after max attempts', async () => {
    behaviour = async () => {
      throw new Error('ConcurrentLedgerCommandException');
    };
    const event = claims.add({ eventType: 'InternalRewardRequested' });

    await job().run(context());
    expect(event.status).toBe('FAILED');
    expect(event.attempts).toBe(1);
    expect(event.lastError).toBe(
      // Review LOW-10: the error class (+ code), never the raw message.
      'test.reward: Error',
    );
    expect(event.availableAt.getTime() - clock.now().getTime()).toBe(30_000);

    clock.set(event.availableAt);
    await job().run(context());
    expect(event.availableAt.getTime() - clock.now().getTime()).toBe(60_000);

    clock.set(event.availableAt);
    await job().run(context());
    expect(event).toMatchObject({
      status: 'DEAD_LETTER',
      terminalState: 'MAX_ATTEMPTS',
      attempts: 3,
    });
  });

  it('dead-letters an invalid payload at once', async () => {
    behaviour = async (event) => {
      throw new OutboxPayloadInvalidError(
        event.eventType,
        'responseId: Required',
      );
    };
    const event = claims.add({ eventType: 'InternalRewardRequested' });
    await job().run(context());
    expect(event).toMatchObject({
      status: 'DEAD_LETTER',
      terminalState: 'INVALID_PAYLOAD',
      attempts: 1,
    });
  });

  it('dead-letters an unsupported schema version without calling the handler', async () => {
    const event = claims.add({
      eventType: 'InternalRewardRequested',
      schemaVersion: 2,
    });
    await job().run(context());
    expect(handled).toHaveLength(0);
    expect(event.terminalState).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('a dead-lettered stream event blocks later sequences of that stream only', async () => {
    claims.add({
      eventType: 'InternalRewardRequested',
      orderingStream: 's1',
      streamSequence: 1,
      status: 'DEAD_LETTER',
    });
    const blocked = claims.add({
      eventType: 'InternalRewardRequested',
      orderingStream: 's1',
      streamSequence: 2,
    });
    const free = claims.add({
      eventType: 'InternalRewardRequested',
      orderingStream: 's2',
      streamSequence: 1,
    });
    await job().run(context());
    expect(blocked.status).toBe('PENDING');
    expect(free.status).toBe('PROCESSED');
  });

  it('T4: a crashed claimant cannot acknowledge after another owner re-claimed', async () => {
    const event = claims.add({ eventType: 'InternalRewardRequested' });
    // Owner A claims and "crashes" (never acknowledges).
    await claims.claimBatch({
      types: ['InternalRewardRequested'],
      owner: 'owner-crashed',
      fencingToken: '1.1',
      now: clock.now(),
      leaseMs: 60_000,
      limit: 20,
    });
    // Before the claim expires nobody else takes it.
    await job().run(context());
    expect(handled).toHaveLength(0);
    // After it expired, B re-claims (attempts 2) and settles once.
    clock.advance(60_001);
    await job().run(context());
    expect(handled).toHaveLength(1);
    expect(event).toMatchObject({ status: 'PROCESSED', attempts: 2 });
    expect(await claims.lockClaimed(event.id, 'owner-crashed', '1.1')).toBe(
      false,
    );
  });

  it('skips handlers that already processed the event (partial earlier run)', async () => {
    const event = claims.add({ eventType: 'InternalRewardRequested' });
    claims.processed.push({ handler: 'test.reward', eventId: event.id });
    await job().run(context());
    expect(handled).toHaveLength(0);
    expect(event.status).toBe('PROCESSED');
  });

  it('backoff stays within 30 s · 2^(n−1) ± 20 %, capped at 1 h', () => {
    expect(outboxBackoffMs(1, () => 0.5)).toBe(30_000);
    expect(outboxBackoffMs(1, () => 0)).toBe(24_000);
    expect(outboxBackoffMs(1, () => 0.999_999)).toBeLessThanOrEqual(36_000);
    expect(outboxBackoffMs(3, () => 0.5)).toBe(120_000);
    expect(outboxBackoffMs(30, () => 0.5)).toBe(3_600_000);
    expect(outboxBackoffMs(30, () => 0.999_999)).toBeLessThanOrEqual(4_320_000);
  });

  it('rejects duplicate handler names', () => {
    expect(() => registry.register({ ...handler })).toThrow(
      /already registered/,
    );
  });

  describe('review MEDIUM-2/3', () => {
    it('runs a kind-(b) handler outside the transaction, bookkeeping inside', async () => {
      const inTransaction: boolean[] = [];
      let open = false;
      const uow = {
        keys: [] as string[],
        async run<T>(key: string, work: () => Promise<T>): Promise<T> {
          open = true;
          try {
            return await work();
          } finally {
            open = false;
          }
        },
      };
      const outside = new OutboxHandlerRegistry();
      outside.register({
        name: 'test.email',
        eventType: 'NotificationEmailRequested',
        schemaVersions: [1],
        runsOutsideTransaction: true,
        handle: async () => {
          inTransaction.push(open);
        },
      });
      const inside = new OutboxHandlerRegistry();
      inside.register({
        ...handler,
        handle: async () => {
          inTransaction.push(open);
        },
      });
      const email = claims.add({ eventType: 'NotificationEmailRequested' });
      const reward = claims.add({ eventType: 'InternalRewardRequested' });
      const options = { intervalMs: 1, maxAttempts: 3 };

      await new OutboxDispatchJob(outside, claims, uow, clock, options).run(
        context(),
      );
      await new OutboxDispatchJob(inside, claims, uow, clock, options).run(
        context(),
      );

      expect(inTransaction).toEqual([false, true]);
      expect(email.status).toBe('PROCESSED');
      expect(reward.status).toBe('PROCESSED');
    });

    it('stops inside a batch when the lease is lost or stopping, handing unstarted claims back', async () => {
      const events = [1, 2, 3].map(() =>
        claims.add({ eventType: 'InternalRewardRequested' }),
      );
      const ctx = { ...context(), shouldContinue: async () => false };

      const summary = await job().run(ctx);

      expect(summary).toMatchObject({ counts: { claimed: 3, processed: 1 } });
      expect(events[0].status).toBe('PROCESSED');
      for (const rest of events.slice(1)) {
        expect(rest).toMatchObject({
          status: 'PENDING',
          claimOwner: null,
          attempts: 0,
        });
      }
    });

    it('releases unstarted claims and rethrows when dispatch fails outside a handler', async () => {
      const events = [1, 2, 3].map(() =>
        claims.add({ eventType: 'InternalRewardRequested' }),
      );
      jest
        .spyOn(claims, 'processedHandlerNames')
        .mockRejectedValueOnce(new Error('db down'));

      await expect(job().run(context())).rejects.toThrow('db down');

      for (const rest of events.slice(1)) {
        expect(rest).toMatchObject({
          status: 'PENDING',
          claimOwner: null,
          attempts: 0,
        });
      }
    });
  });
});
