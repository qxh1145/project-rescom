import { Logger } from '@nestjs/common';
import { EnvService } from '../../../../common/config/env.service';
import { FixedClock } from '../../../../common/time/clock';
import { InMemoryJobLeaseRepository } from '../../../../common/scheduler/job-lease.repository';
import { ScheduledJobRegistry } from '../../../../common/scheduler/scheduled-job';
import { SchedulerRunnerService } from '../../../../common/scheduler/scheduler-runner.service';
import { FakePaymentProvider } from '../fake-payment-provider';
import { InMemoryPayosTopUpRepository } from '../in-memory-payos-top-up.repository';
import { TopUpAdminAlerts } from '../../application/top-up-admin-alerts';
import {
  PayosReconcileJob,
  PayosReconcileService,
} from './payos-reconcile.job';
import { PayosTopUp } from '../../application/ports/payos-top-up-repository.port';
import { ProviderPaymentSnapshot } from '../../application/ports/payment-provider.port';

const BASE_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

function createEnv(overrides: Record<string, unknown> = {}): EnvService {
  return new EnvService({ ...BASE_ENV, ...overrides });
}

function seedTopUp(
  repo: InMemoryPayosTopUpRepository,
  overrides: { id: string; orderCode: number; amountVnd: number },
): PayosTopUp {
  const row: PayosTopUp = {
    id: overrides.id,
    userId: 'user-lease-test',
    orderCode: overrides.orderCode,
    amountVnd: overrides.amountVnd,
    points: overrides.amountVnd / 200,
    status: 'PROCESSING',
    checkoutUrl: null,
    paymentLinkId: null,
    expiresAt: new Date('2026-10-15T12:05:00.000Z'),
    cancelledAt: null,
    paidAt: null,
    journalId: null,
    pointsCredited: null,
    amountPaidVnd: null,
    providerReference: null,
    counterAccountBankId: null,
    counterAccountBankName: null,
    counterAccountName: null,
    counterAccountNumber: null,
    createdAt: new Date('2026-10-15T12:00:00.000Z'),
  };
  repo.rows.set(row.id, row);
  return row;
}

function createService(
  repo: InMemoryPayosTopUpRepository,
): PayosReconcileService {
  return {
    applySnapshot: async (id: string, snapshot: ProviderPaymentSnapshot) => {
      const row = repo.rows.get(id);
      if (!row) return { outcome: 'IGNORED' as const, effect: snapshot.effect };
      if (snapshot.effect === 'CREDIT') {
        const changed = await repo.markSuccessful(
          id,
          {
            journalId: 'journal-lease',
            pointsCredited: row.amountVnd / 200,
            facts: snapshot.facts,
            verifiedAt: snapshot.facts.paidAt ?? new Date(),
          },
          {
            id: 'evt-credit',
            idempotencyKey: `topup-credit:${id}`,
            eventType: 'ECONOMY_TOPUP_STATUS_CHANGED',
            producer: 'economy-service',
            aggregateType: 'PayosTopUp',
            aggregateId: id,
            aggregateVersion: 3,
            payload: {
              schemaVersion: 1,
              topUpId: id,
              userId: row.userId,
              orderCode: row.orderCode,
              amountVnd: row.amountVnd,
              points: row.points,
              status: 'SUCCESSFUL',
              occurredAt: new Date().toISOString(),
            },
          },
        );
        return {
          outcome: changed.changed
            ? ('APPLIED' as const)
            : ('IGNORED' as const),
          effect: 'CREDIT',
        };
      }
      return { outcome: 'IGNORED' as const, effect: snapshot.effect };
    },
    expireTopUp: async () => ({ outcome: 'IGNORED' as const }),
    closeFromProvider: async () => ({ outcome: 'IGNORED' as const }),
  };
}

describe('PayosReconcileJob Lease Test (Story 13.5 AC 7)', () => {
  const start = new Date('2026-10-15T12:00:00.000Z');
  let clock: FixedClock;
  let leases: InMemoryJobLeaseRepository;
  let repo: InMemoryPayosTopUpRepository;
  let provider: FakePaymentProvider;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    clock = new FixedClock(start);
    leases = new InMemoryJobLeaseRepository();
    repo = new InMemoryPayosTopUpRepository();
    provider = new FakePaymentProvider('fake-key');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('two runners never process the same row concurrently; each candidate orderCode gets exactly one getPayment call', async () => {
    const candidates = [
      { id: 'topup-lease-1', orderCode: 9001, amountVnd: 50_000 },
      { id: 'topup-lease-2', orderCode: 9002, amountVnd: 100_000 },
      { id: 'topup-lease-3', orderCode: 9003, amountVnd: 200_000 },
    ];

    for (const c of candidates) {
      seedTopUp(repo, c);
      provider.setPayment(c.orderCode, {
        orderCode: c.orderCode,
        status: 'PAID',
        amountPaid: c.amountVnd,
        transactions: [
          {
            reference: `ref-${c.orderCode}`,
            transactionDateTime: '2026-10-15 12:00:00',
          },
        ],
      });
    }

    const getPaymentSpy = jest.spyOn(provider, 'getPayment');

    // Instance A
    const registryA = new ScheduledJobRegistry();
    const serviceA = createService(repo);
    const alertsA = new TopUpAdminAlerts(repo, () => clock.now());
    const jobA = new PayosReconcileJob(serviceA, repo, provider, alertsA);
    registryA.register(jobA);
    const runnerA = new SchedulerRunnerService(
      createEnv(),
      registryA,
      leases,
      clock,
    );

    // Instance B
    const registryB = new ScheduledJobRegistry();
    const serviceB = createService(repo);
    const alertsB = new TopUpAdminAlerts(repo, () => clock.now());
    const jobB = new PayosReconcileJob(serviceB, repo, provider, alertsB);
    registryB.register(jobB);
    const runnerB = new SchedulerRunnerService(
      createEnv(),
      registryB,
      leases,
      clock,
    );

    // Two runners race to run payos-reconcile concurrently
    const [resA, resB] = await Promise.all([
      runnerA.runJobOnce('payos-reconcile'),
      runnerB.runJobOnce('payos-reconcile'),
    ]);

    // One wins and SUCCEEDS, the other loses the lease and is SKIPPED
    expect([resA.outcome, resB.outcome].sort()).toEqual([
      'SKIPPED',
      'SUCCEEDED',
    ]);

    // Assert each candidate orderCode got exactly one getPayment call
    expect(getPaymentSpy).toHaveBeenCalledTimes(candidates.length);
    for (const c of candidates) {
      expect(getPaymentSpy).toHaveBeenCalledWith(c.orderCode, c.amountVnd);
    }

    // All rows reached SUCCESSFUL
    for (const c of candidates) {
      expect(repo.rows.get(c.id)?.status).toBe('SUCCESSFUL');
    }
  });
});
