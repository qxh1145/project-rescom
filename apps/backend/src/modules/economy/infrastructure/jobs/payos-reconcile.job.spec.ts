import { FixedClock } from '../../../../common/time/clock';
import { testJobContext } from '../../../../common/scheduler/test-job-context';
import { FakePaymentProvider } from '../fake-payment-provider';
import { InMemoryPayosTopUpRepository } from '../in-memory-payos-top-up.repository';
import { TopUpAdminAlerts } from '../../application/top-up-admin-alerts';
import {
  PayosReconcileJob,
  PayosReconcileService,
} from './payos-reconcile.job';
import { PayosTopUp } from '../../application/ports/payos-top-up-repository.port';
import {
  ProviderPaymentEffect,
  ProviderPaymentSnapshot,
} from '../../application/ports/payment-provider.port';

function seedTopUp(
  repo: InMemoryPayosTopUpRepository,
  overrides: Partial<PayosTopUp> & {
    id: string;
    orderCode: number;
    amountVnd: number;
  },
): PayosTopUp {
  const row: PayosTopUp = {
    id: overrides.id,
    userId: overrides.userId ?? 'user-1',
    orderCode: overrides.orderCode,
    amountVnd: overrides.amountVnd,
    points: overrides.points ?? overrides.amountVnd / 200,
    status: overrides.status ?? 'PROCESSING',
    checkoutUrl: overrides.checkoutUrl ?? null,
    paymentLinkId: overrides.paymentLinkId ?? null,
    expiresAt: overrides.expiresAt ?? new Date('2026-10-15T12:05:00.000Z'),
    cancelledAt: overrides.cancelledAt ?? null,
    paidAt: overrides.paidAt ?? null,
    journalId: overrides.journalId ?? null,
    pointsCredited: overrides.pointsCredited ?? null,
    amountPaidVnd: overrides.amountPaidVnd ?? null,
    providerReference: overrides.providerReference ?? null,
    counterAccountBankId: overrides.counterAccountBankId ?? null,
    counterAccountBankName: overrides.counterAccountBankName ?? null,
    counterAccountName: overrides.counterAccountName ?? null,
    counterAccountNumber: overrides.counterAccountNumber ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-10-15T12:00:00.000Z'),
  };
  repo.rows.set(row.id, row);
  return row;
}

function createTestService(
  repo: InMemoryPayosTopUpRepository,
  overrides?: Partial<PayosReconcileService>,
): PayosReconcileService {
  return {
    applySnapshot: jest.fn(
      async (
        id: string,
        snapshot: ProviderPaymentSnapshot,
      ): Promise<{
        outcome: 'IGNORED' | 'APPLIED';
        effect: ProviderPaymentEffect;
      }> => {
        const row = repo.rows.get(id);
        if (!row)
          return { outcome: 'IGNORED' as const, effect: snapshot.effect };

        if (snapshot.effect === 'CREDIT') {
          const changed = await repo.markSuccessful(
            id,
            {
              journalId: 'journal-test',
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

        if (snapshot.effect === 'AMOUNT_MISMATCH') {
          const changed = await repo.markAmountMismatch(
            id,
            {
              facts: snapshot.facts,
              verifiedAt: new Date(),
            },
            {
              id: `evt-mismatch-${snapshot.facts.amountPaidVnd}`,
              idempotencyKey: `topup-mismatch-notice:${id}:${snapshot.facts.amountPaidVnd}`,
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
                status: 'AMOUNT_MISMATCH',
                amountPaidVnd: snapshot.facts.amountPaidVnd,
                occurredAt: new Date().toISOString(),
              },
            },
          );
          return {
            outcome: changed.changed
              ? ('APPLIED' as const)
              : ('IGNORED' as const),
            effect: 'AMOUNT_MISMATCH',
          };
        }

        return { outcome: 'IGNORED' as const, effect: snapshot.effect };
      },
    ),

    expireTopUp: jest.fn(async (id: string, now: Date) => {
      const row = repo.rows.get(id);
      if (!row) return { outcome: 'IGNORED' as const };
      const changed = await repo.markExpired(id, now, {
        id: 'evt-expire',
        idempotencyKey: `topup-expire:${id}`,
        eventType: 'ECONOMY_TOPUP_STATUS_CHANGED',
        producer: 'economy-service',
        aggregateType: 'PayosTopUp',
        aggregateId: id,
        aggregateVersion: 2,
        payload: {
          schemaVersion: 1,
          topUpId: id,
          userId: row.userId,
          orderCode: row.orderCode,
          amountVnd: row.amountVnd,
          points: row.points,
          status: 'EXPIRED',
          occurredAt: now.toISOString(),
        },
      });
      return {
        outcome: changed.changed ? ('APPLIED' as const) : ('IGNORED' as const),
      };
    }),

    closeFromProvider: jest.fn(
      async (id: string, effect: 'CANCELLED' | 'EXPIRED', now: Date) => {
        const row = repo.rows.get(id);
        if (!row) return { outcome: 'IGNORED' as const };
        if (effect === 'CANCELLED') {
          const changed = await repo.markCancelled(id, now, {
            id: 'evt-cancel',
            idempotencyKey: `topup-cancel:${id}`,
            eventType: 'ECONOMY_TOPUP_STATUS_CHANGED',
            producer: 'economy-service',
            aggregateType: 'PayosTopUp',
            aggregateId: id,
            aggregateVersion: 2,
            payload: {
              schemaVersion: 1,
              topUpId: id,
              userId: row.userId,
              orderCode: row.orderCode,
              amountVnd: row.amountVnd,
              points: row.points,
              status: 'CANCELLED',
              occurredAt: now.toISOString(),
            },
          });
          return {
            outcome: changed.changed
              ? ('APPLIED' as const)
              : ('IGNORED' as const),
          };
        }
        const changed = await repo.markExpired(id, now, {
          id: 'evt-expire',
          idempotencyKey: `topup-expire:${id}`,
          eventType: 'ECONOMY_TOPUP_STATUS_CHANGED',
          producer: 'economy-service',
          aggregateType: 'PayosTopUp',
          aggregateId: id,
          aggregateVersion: 2,
          payload: {
            schemaVersion: 1,
            topUpId: id,
            userId: row.userId,
            orderCode: row.orderCode,
            amountVnd: row.amountVnd,
            points: row.points,
            status: 'EXPIRED',
            occurredAt: now.toISOString(),
          },
        });
        return {
          outcome: changed.changed
            ? ('APPLIED' as const)
            : ('IGNORED' as const),
        };
      },
    ),
    ...overrides,
  };
}

describe('PayosReconcileJob (Story 13.5 Task 5)', () => {
  const baseNow = new Date('2026-10-15T12:10:00.000Z');
  let clock: FixedClock;
  let repo: InMemoryPayosTopUpRepository;
  let provider: FakePaymentProvider;
  let alerts: TopUpAdminAlerts;
  let service: PayosReconcileService;
  let job: PayosReconcileJob;

  beforeEach(() => {
    clock = new FixedClock(baseNow);
    repo = new InMemoryPayosTopUpRepository();
    provider = new FakePaymentProvider('fake-key');
    alerts = new TopUpAdminAlerts(repo, () => clock.now());
    service = createTestService(repo);
    job = new PayosReconcileJob(service, repo, provider, alerts);
  });

  it('PROCESSING + PAID full -> SUCCESSFUL', async () => {
    seedTopUp(repo, {
      id: 'topup-1',
      orderCode: 1001,
      amountVnd: 50_000,
      status: 'PROCESSING',
      expiresAt: new Date(baseNow.getTime() + 5 * 60_000),
    });
    provider.setPayment(1001, {
      orderCode: 1001,
      status: 'PAID',
      amountPaid: 50_000,
      transactions: [
        {
          reference: 'ref-1',
          transactionDateTime: '2026-10-15 19:05:00',
        },
      ],
    });

    const summary = await job.run(testJobContext(clock.now()));

    expect(summary.status).toBe('SUCCEEDED');
    expect(summary.counts.scannedCount).toBe(1);
    expect(summary.counts.creditedCount).toBe(1);
    expect(repo.rows.get('topup-1')?.status).toBe('SUCCESSFUL');
  });

  it('PROCESSING past expiresAt + PENDING -> EXPIRED, then cancelCalls entry and EXPIRED event', async () => {
    seedTopUp(repo, {
      id: 'topup-2',
      orderCode: 1002,
      amountVnd: 50_000,
      status: 'PROCESSING',
      expiresAt: new Date(baseNow.getTime() - 60_000), // past expiry
    });
    provider.setPayment(1002, {
      orderCode: 1002,
      status: 'PENDING',
      amountPaid: 0,
      transactions: [],
    });

    const summary = await job.run(testJobContext(clock.now()));

    expect(summary.status).toBe('SUCCEEDED');
    expect(summary.counts.expiredCount).toBe(1);
    expect(repo.rows.get('topup-2')?.status).toBe('EXPIRED');
    expect(provider.cancelCalls).toEqual([
      { orderCode: 1002, reason: 'Hết hạn' },
    ]);
    const expireEvent = repo.events.find(
      (e) => e.idempotencyKey === 'topup-expire:topup-2',
    );
    expect(expireEvent).toBeDefined();
    expect(expireEvent?.payload.status).toBe('EXPIRED');
  });

  it('PROCESSING past expiresAt + GET throws -> still EXPIRED', async () => {
    seedTopUp(repo, {
      id: 'topup-3',
      orderCode: 1003,
      amountVnd: 50_000,
      status: 'PROCESSING',
      expiresAt: new Date(baseNow.getTime() - 60_000),
    });
    provider.failNext('getPayment');

    await expect(job.run(testJobContext(clock.now()))).rejects.toThrow();

    expect(repo.rows.get('topup-3')?.status).toBe('EXPIRED');
    expect(provider.cancelCalls).toEqual([
      { orderCode: 1003, reason: 'Hết hạn' },
    ]);
  });

  it('PROCESSING past expiresAt + PAID -> SUCCESSFUL, not EXPIRED', async () => {
    seedTopUp(repo, {
      id: 'topup-4',
      orderCode: 1004,
      amountVnd: 50_000,
      status: 'PROCESSING',
      expiresAt: new Date(baseNow.getTime() - 60_000),
    });
    provider.setPayment(1004, {
      orderCode: 1004,
      status: 'PAID',
      amountPaid: 50_000,
      transactions: [
        {
          reference: 'ref-4',
          transactionDateTime: '2026-10-15 19:08:00',
        },
      ],
    });

    const summary = await job.run(testJobContext(clock.now()));

    expect(summary.status).toBe('SUCCEEDED');
    expect(summary.counts.creditedCount).toBe(1);
    expect(summary.counts.expiredCount).toBe(0);
    expect(repo.rows.get('topup-4')?.status).toBe('SUCCESSFUL');
    expect(provider.cancelCalls).toHaveLength(0);
  });

  it('PROCESSING not expired + provider CANCELLED -> CANCELLED', async () => {
    seedTopUp(repo, {
      id: 'topup-5',
      orderCode: 1005,
      amountVnd: 50_000,
      status: 'PROCESSING',
      expiresAt: new Date(baseNow.getTime() + 5 * 60_000),
    });
    provider.setPayment(1005, {
      orderCode: 1005,
      status: 'CANCELLED',
      amountPaid: 0,
      transactions: [],
    });

    const summary = await job.run(testJobContext(clock.now()));

    expect(summary.status).toBe('SUCCEEDED');
    expect(summary.counts.closedCount).toBe(1);
    expect(repo.rows.get('topup-5')?.status).toBe('CANCELLED');
  });

  it('PROCESSING past expiresAt + provider CANCELLED -> EXPIRED with best-effort cancel (C1)', async () => {
    seedTopUp(repo, {
      id: 'topup-5b',
      orderCode: 1015,
      amountVnd: 50_000,
      status: 'PROCESSING',
      expiresAt: new Date(baseNow.getTime() - 60_000),
    });
    provider.setPayment(1015, {
      orderCode: 1015,
      status: 'CANCELLED',
      amountPaid: 0,
      transactions: [],
    });

    const summary = await job.run(testJobContext(clock.now()));

    expect(summary.counts.expiredCount).toBe(1);
    expect(summary.counts.closedCount).toBe(0);
    expect(repo.rows.get('topup-5b')?.status).toBe('EXPIRED');
    expect(provider.cancelCalls).toEqual([
      { orderCode: 1015, reason: 'Hết hạn' },
    ]);
  });

  it('does not cancel the provider link when expireTopUp loses the race', async () => {
    seedTopUp(repo, {
      id: 'topup-5c',
      orderCode: 1016,
      amountVnd: 50_000,
      status: 'PROCESSING',
      expiresAt: new Date(baseNow.getTime() - 60_000),
    });
    provider.setPayment(1016, {
      orderCode: 1016,
      status: 'PENDING',
      amountPaid: 0,
      transactions: [],
    });
    (service.expireTopUp as jest.Mock).mockResolvedValueOnce({
      outcome: 'IGNORED',
    });

    const summary = await job.run(testJobContext(clock.now()));

    expect(summary.counts.expiredCount).toBe(0);
    expect(provider.cancelCalls).toHaveLength(0);
  });

  it('CANCELLED 23h ago + PAID -> SUCCESSFUL; CANCELLED 25h ago is not scanned', async () => {
    seedTopUp(repo, {
      id: 'topup-6',
      orderCode: 1006,
      amountVnd: 50_000,
      status: 'CANCELLED',
      cancelledAt: new Date(baseNow.getTime() - 23 * 3600_000),
    });
    seedTopUp(repo, {
      id: 'topup-7',
      orderCode: 1007,
      amountVnd: 50_000,
      status: 'CANCELLED',
      cancelledAt: new Date(baseNow.getTime() - 25 * 3600_000),
    });

    provider.setPayment(1006, {
      orderCode: 1006,
      status: 'PAID',
      amountPaid: 50_000,
      transactions: [
        { reference: 'ref-6', transactionDateTime: '2026-10-14 13:00:00' },
      ],
    });
    provider.setPayment(1007, {
      orderCode: 1007,
      status: 'PAID',
      amountPaid: 50_000,
      transactions: [],
    });

    const getSpy = jest.spyOn(provider, 'getPayment');
    const summary = await job.run(testJobContext(clock.now()));

    expect(summary.counts.scannedCount).toBe(1);
    expect(summary.counts.creditedCount).toBe(1);
    expect(repo.rows.get('topup-6')?.status).toBe('SUCCESSFUL');
    expect(repo.rows.get('topup-7')?.status).toBe('CANCELLED');
    expect(getSpy).toHaveBeenCalledWith(1006, 50_000);
    expect(getSpy).not.toHaveBeenCalledWith(1007, expect.anything());
  });

  it('AMOUNT_MISMATCH + larger UNDERPAID -> refreshed amountPaidVnd, paidAt unchanged, new notice; same amount -> no new event', async () => {
    const originalPaidAt = new Date('2026-10-15T10:00:00.000Z');
    seedTopUp(repo, {
      id: 'topup-8',
      orderCode: 1008,
      amountVnd: 100_000,
      amountPaidVnd: 20_000,
      paidAt: originalPaidAt,
      status: 'AMOUNT_MISMATCH',
    });

    provider.setPayment(1008, {
      orderCode: 1008,
      status: 'UNDERPAID',
      amountPaid: 40_000,
      transactions: [
        { reference: 'ref-8a', transactionDateTime: '2026-10-15 17:00:00' },
        { reference: 'ref-8b', transactionDateTime: '2026-10-15 17:30:00' },
      ],
    });

    // Run 1: larger underpaid
    const s1 = await job.run(testJobContext(clock.now()));
    expect(s1.counts.mismatchCount).toBe(1);
    const rowAfter1 = repo.rows.get('topup-8')!;
    expect(rowAfter1.amountPaidVnd).toBe(40_000);
    expect(rowAfter1.paidAt?.getTime()).toBe(originalPaidAt.getTime());
    const mismatchEvents1 = repo.events.filter(
      (e) => e.payload.status === 'AMOUNT_MISMATCH',
    );
    expect(mismatchEvents1).toHaveLength(1);
    expect(mismatchEvents1[0].payload.amountPaidVnd).toBe(40_000);

    // Run 2: same amount 40_000
    const s2 = await job.run(testJobContext(clock.now()));
    expect(s2.counts.mismatchCount).toBe(0);
    const mismatchEvents2 = repo.events.filter(
      (e) => e.payload.status === 'AMOUNT_MISMATCH',
    );
    expect(mismatchEvents2).toHaveLength(1);
  });

  it('AMOUNT_MISMATCH + PAID full -> SUCCESSFUL', async () => {
    seedTopUp(repo, {
      id: 'topup-9',
      orderCode: 1009,
      amountVnd: 100_000,
      amountPaidVnd: 40_000,
      status: 'AMOUNT_MISMATCH',
    });
    provider.setPayment(1009, {
      orderCode: 1009,
      status: 'PAID',
      amountPaid: 100_000,
      transactions: [
        { reference: 'ref-9', transactionDateTime: '2026-10-15 18:00:00' },
      ],
    });

    const summary = await job.run(testJobContext(clock.now()));

    expect(summary.status).toBe('SUCCEEDED');
    expect(summary.counts.creditedCount).toBe(1);
    expect(repo.rows.get('topup-9')?.status).toBe('SUCCESSFUL');
  });

  it('No candidates -> zero provider calls', async () => {
    repo.rows.clear();
    const getSpy = jest.spyOn(provider, 'getPayment');

    const summary = await job.run(testJobContext(clock.now()));

    expect(summary.status).toBe('SUCCEEDED');
    expect(summary.counts.scannedCount).toBe(0);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('Lease lost -> stops before the next row', async () => {
    seedTopUp(repo, {
      id: 'topup-a',
      orderCode: 2001,
      amountVnd: 50_000,
      status: 'PROCESSING',
    });
    seedTopUp(repo, {
      id: 'topup-b',
      orderCode: 2002,
      amountVnd: 50_000,
      status: 'PROCESSING',
    });
    provider.setPayment(2001, {
      orderCode: 2001,
      status: 'PAID',
      amountPaid: 50_000,
      transactions: [],
    });
    provider.setPayment(2002, {
      orderCode: 2002,
      status: 'PAID',
      amountPaid: 50_000,
      transactions: [],
    });

    // shouldContinue answers true for batch, true for topup-a, false for topup-b
    const ctx = testJobContext(clock.now(), [true, false]);
    const summary = await job.run(ctx);

    expect(summary.counts.scannedCount).toBe(1);
    expect(summary.hasMore).toBe(true);
    expect(repo.rows.get('topup-a')?.status).toBe('SUCCESSFUL');
    expect(repo.rows.get('topup-b')?.status).toBe('PROCESSING');
  });

  it('Cursor carries across runs and resets at the end', async () => {
    seedTopUp(repo, {
      id: 'topup-c1',
      orderCode: 3001,
      amountVnd: 50_000,
      status: 'PROCESSING',
    });
    seedTopUp(repo, {
      id: 'topup-c2',
      orderCode: 3002,
      amountVnd: 50_000,
      status: 'PROCESSING',
    });
    provider.setPayment(3001, {
      orderCode: 3001,
      status: 'PAID',
      amountPaid: 50_000,
      transactions: [],
    });
    provider.setPayment(3002, {
      orderCode: 3002,
      status: 'PAID',
      amountPaid: 50_000,
      transactions: [],
    });

    // Create a job with maxBatches = 1 and batchSize = 1
    const pagedJob = new PayosReconcileJob(
      service,
      repo,
      provider,
      alerts,
      1,
      1,
    );

    // Run 1: processes topup-c1
    const s1 = await pagedJob.run(testJobContext(clock.now()));
    expect(s1.counts.scannedCount).toBe(1);
    expect(pagedJob['cursor']).toBe('topup-c1');

    // Run 2: processes topup-c2
    const s2 = await pagedJob.run(testJobContext(clock.now()));
    expect(s2.counts.scannedCount).toBe(1);

    // Run 3: no more rows -> cursor resets to undefined
    const s3 = await pagedJob.run(testJobContext(clock.now()));
    expect(s3.hasMore).toBe(false);
    expect(pagedJob['cursor']).toBeUndefined();
  });

  describe('Alert conditions raise exactly once across two runs', () => {
    it('UNCREDITED_AFTER_PAYMENT: paidAt 31m ago raises alert, 29m does not, raised once', async () => {
      // Throw in applySnapshot only for topup-u31 to simulate credit failure
      const failingService = createTestService(repo, {
        applySnapshot: jest.fn(
          async (id: string, snapshot: ProviderPaymentSnapshot) => {
            if (id === '00000000-0000-4000-8000-000000000031') {
              throw new Error('DB credit failed');
            }
            return service.applySnapshot(id, snapshot);
          },
        ),
      });
      const alertJob = new PayosReconcileJob(
        failingService,
        repo,
        provider,
        alerts,
      );

      // Row 1: paid 29 minutes ago
      seedTopUp(repo, {
        id: '00000000-0000-4000-8000-000000000029',
        orderCode: 4001,
        amountVnd: 50_000,
        status: 'PROCESSING',
      });
      provider.setPayment(4001, {
        orderCode: 4001,
        status: 'PAID',
        amountPaid: 50_000,
        transactions: [
          {
            reference: 'ref-u29',
            transactionDateTime: new Date(
              baseNow.getTime() - 29 * 60_000,
            ).toISOString(),
          },
        ],
      });

      // Row 2: paid 31 minutes ago
      seedTopUp(repo, {
        id: '00000000-0000-4000-8000-000000000031',
        orderCode: 4002,
        amountVnd: 50_000,
        status: 'PROCESSING',
      });
      provider.setPayment(4002, {
        orderCode: 4002,
        status: 'PAID',
        amountPaid: 50_000,
        transactions: [
          {
            reference: 'ref-u31',
            transactionDateTime: new Date(
              baseNow.getTime() - 31 * 60_000,
            ).toISOString(),
          },
        ],
      });

      // Run 1
      const s1 = await alertJob.run(testJobContext(clock.now()));
      expect(s1.counts.alertsRaisedCount).toBe(1);
      const uncreditedAlerts1 = repo.alertEvents.filter(
        (e) => e.payload.condition === 'UNCREDITED_AFTER_PAYMENT',
      );
      expect(uncreditedAlerts1).toHaveLength(1);
      expect(uncreditedAlerts1[0].payload.topUpId).toBe(
        '00000000-0000-4000-8000-000000000031',
      );

      // Run 2: duplicate alert is ignored even if row fails again
      await alertJob.run(testJobContext(clock.now())).catch(() => {});
      const uncreditedAlerts2 = repo.alertEvents.filter(
        (e) => e.payload.condition === 'UNCREDITED_AFTER_PAYMENT',
      );
      expect(uncreditedAlerts2).toHaveLength(1);
    });

    it('PAID_ON_CLOSED_LINK: provider CANCELLED with amountPaid > 0 raises once', async () => {
      seedTopUp(repo, {
        id: '00000000-0000-4000-8000-000000000043',
        orderCode: 4003,
        amountVnd: 50_000,
        status: 'CANCELLED',
        cancelledAt: new Date(baseNow.getTime() - 3600_000),
      });
      provider.setPayment(4003, {
        orderCode: 4003,
        status: 'CANCELLED',
        amountPaid: 50_000,
        transactions: [
          {
            reference: 'ref-cl',
            transactionDateTime: '2026-10-15 11:00:00',
          },
        ],
      });

      // Run 1
      const s1 = await job.run(testJobContext(clock.now()));
      expect(s1.counts.alertsRaisedCount).toBe(1);
      const closedAlerts = repo.alertEvents.filter(
        (e) => e.payload.condition === 'PAID_ON_CLOSED_LINK',
      );
      expect(closedAlerts).toHaveLength(1);
      expect(closedAlerts[0].payload.topUpId).toBe(
        '00000000-0000-4000-8000-000000000043',
      );

      // Run 2
      const s2 = await job.run(testJobContext(clock.now()));
      expect(s2.counts.alertsRaisedCount).toBe(0);
      expect(
        repo.alertEvents.filter(
          (e) => e.payload.condition === 'PAID_ON_CLOSED_LINK',
        ),
      ).toHaveLength(1);
    });

    it('MISMATCH_SLA_BREACHED: across weekend raises once when SLA is breached', async () => {
      // Friday 2026-10-16 10:00 VN (03:00Z)
      // +3 business days in VN = Wednesday 2026-10-21 10:00 VN (03:00Z)
      const paidAtFri = new Date('2026-10-16T03:00:00.000Z');
      seedTopUp(repo, {
        id: '00000000-0000-4000-8000-000000000044',
        orderCode: 4004,
        amountVnd: 100_000,
        amountPaidVnd: 30_000,
        paidAt: paidAtFri,
        status: 'AMOUNT_MISMATCH',
      });
      provider.setPayment(4004, {
        orderCode: 4004,
        status: 'UNDERPAID',
        amountPaid: 30_000,
        transactions: [
          { reference: 'ref-m', transactionDateTime: '2026-10-16 10:00:00' },
        ],
      });

      // Tuesday 2026-10-20 (2 business days passed): no alert
      const tuesdayClock = new Date('2026-10-20T03:00:00.000Z');
      const s1 = await job.run(testJobContext(tuesdayClock));
      expect(s1.counts.alertsRaisedCount).toBe(0);

      // Wednesday 2026-10-21 11:00 VN (04:00Z) (3 business days breached): alert raised
      const wednesdayClock = new Date('2026-10-21T04:00:00.000Z');
      const s2 = await job.run(testJobContext(wednesdayClock));
      expect(s2.counts.alertsRaisedCount).toBe(1);
      expect(
        repo.alertEvents.filter(
          (e) => e.payload.condition === 'MISMATCH_SLA_BREACHED',
        ),
      ).toHaveLength(1);

      // Run again: deduped
      const s3 = await job.run(testJobContext(wednesdayClock));
      expect(s3.counts.alertsRaisedCount).toBe(0);
      expect(
        repo.alertEvents.filter(
          (e) => e.payload.condition === 'MISMATCH_SLA_BREACHED',
        ),
      ).toHaveLength(1);
    });

    it('REFUND_SLA_BREACHED: across weekend raises once when SLA is breached', async () => {
      // Friday 2026-10-16 10:00 VN (03:00Z)
      // +3 business days in VN = Wednesday 2026-10-21 10:00 VN (03:00Z)
      const requestedAtFri = new Date('2026-10-16T03:00:00.000Z');
      const refundId = '00000000-0000-4000-8000-000000000055';
      const topUpId = '00000000-0000-4000-8000-000000000056';
      seedTopUp(repo, {
        id: topUpId,
        orderCode: 4006,
        amountVnd: 50_000,
        status: 'SUCCESSFUL',
      });
      repo.refundRequests.set(refundId, {
        id: refundId,
        topUpId,
        userId: 'user-ref',
        topUpJournalId: 'j-1',
        holdJournalId: 'h-1',
        releaseJournalId: null,
        status: 'REQUESTED',
        eligibility: 'ELIGIBLE',
        ineligibleReason: null,
        reason: 'OTHER',
        note: '',
        points: 250,
        amountVnd: 50_000,
        counterAccountBankId: '970422',
        counterAccountBankName: 'MBBank',
        counterAccountName: 'A',
        counterAccountNumber: '0123',
        destinationVerified: true,
        withdrawnAt: null,
        resolvedAt: null,
        rejectionReason: null,
        manualTransferRecorded: false,
        resolvedByAdminId: null,
        resolveJournalId: null,
        bankTransferReference: null,
        bankTransferredAt: null,
        bankTransferRecordedAt: null,
        correlationId: null,
        createdAt: requestedAtFri,
        updatedAt: requestedAtFri,
      });

      // Tuesday 2026-10-20: 2 business days -> no alert
      const tuesday = new Date('2026-10-20T03:00:00.000Z');
      await job.run(testJobContext(tuesday));
      expect(
        repo.alertEvents.filter(
          (e) => e.payload.condition === 'REFUND_SLA_BREACHED',
        ),
      ).toHaveLength(0);

      // Wednesday 2026-10-21 04:00Z: 3 business days passed -> raises alert
      const wednesday = new Date('2026-10-21T04:00:00.000Z');
      const s2 = await job.run(testJobContext(wednesday));
      expect(s2.counts.alertsRaisedCount).toBe(1);
      const refundAlerts = repo.alertEvents.filter(
        (e) => e.payload.condition === 'REFUND_SLA_BREACHED',
      );
      expect(refundAlerts).toHaveLength(1);
      expect(refundAlerts[0].payload.refundRequestId).toBe(refundId);

      // Run again: deduped
      const s3 = await job.run(testJobContext(wednesday));
      expect(s3.counts.alertsRaisedCount).toBe(0);
      expect(
        repo.alertEvents.filter(
          (e) => e.payload.condition === 'REFUND_SLA_BREACHED',
        ),
      ).toHaveLength(1);
    });

    it('REFUND_SLA_BREACHED: skips resolved requests', async () => {
      const refundId = '00000000-0000-4000-8000-000000000057';
      const topUpId = '00000000-0000-4000-8000-000000000058';
      const requestedAtFri = new Date('2026-10-16T03:00:00.000Z');
      seedTopUp(repo, {
        id: topUpId,
        orderCode: 4007,
        amountVnd: 50_000,
        status: 'SUCCESSFUL',
      });
      repo.refundRequests.set(refundId, {
        id: refundId,
        topUpId,
        userId: 'user-ref',
        topUpJournalId: 'j-1',
        holdJournalId: null,
        releaseJournalId: null,
        status: 'REFUNDED',
        eligibility: 'ELIGIBLE',
        ineligibleReason: null,
        reason: 'OTHER',
        note: '',
        points: 250,
        amountVnd: 50_000,
        counterAccountBankId: null,
        counterAccountBankName: null,
        counterAccountName: null,
        counterAccountNumber: null,
        destinationVerified: true,
        withdrawnAt: null,
        resolvedAt: new Date('2026-10-17T03:00:00.000Z'),
        rejectionReason: null,
        manualTransferRecorded: false,
        resolvedByAdminId: null,
        resolveJournalId: 'j-2',
        bankTransferReference: null,
        bankTransferredAt: null,
        bankTransferRecordedAt: null,
        correlationId: null,
        createdAt: requestedAtFri,
        updatedAt: requestedAtFri,
      });
      await job.run(testJobContext(new Date('2026-10-30T04:00:00.000Z')));
      expect(
        repo.alertEvents.filter(
          (e) => e.payload.condition === 'REFUND_SLA_BREACHED',
        ),
      ).toHaveLength(0);
    });

    it('PROVIDER_FAILURE: 3 consecutive all-failed runs alert once; 4th still 1; success then 3 more alerts new episode', async () => {
      seedTopUp(repo, {
        id: 'topup-pf',
        orderCode: 4005,
        amountVnd: 50_000,
        status: 'PROCESSING',
      });

      // Run 1: provider fails
      provider.failNext('getPayment');
      await expect(job.run(testJobContext(clock.now()))).rejects.toThrow();

      // Run 2: provider fails
      provider.failNext('getPayment');
      await expect(job.run(testJobContext(clock.now()))).rejects.toThrow();
      expect(
        repo.alertEvents.filter(
          (e) => e.payload.condition === 'PROVIDER_FAILURE',
        ),
      ).toHaveLength(0);

      // Run 3: provider fails -> 3rd consecutive failed run -> 1 alert raised
      provider.failNext('getPayment');
      await expect(job.run(testJobContext(clock.now()))).rejects.toThrow();
      const pfAlerts1 = repo.alertEvents.filter(
        (e) => e.payload.condition === 'PROVIDER_FAILURE',
      );
      expect(pfAlerts1).toHaveLength(1);

      // Run 4: still failing -> deduped, still 1 alert
      provider.failNext('getPayment');
      await expect(job.run(testJobContext(clock.now()))).rejects.toThrow();
      expect(
        repo.alertEvents.filter(
          (e) => e.payload.condition === 'PROVIDER_FAILURE',
        ),
      ).toHaveLength(1);

      // Run 5: provider succeeds -> resets episode
      provider.setPayment(4005, {
        orderCode: 4005,
        status: 'PENDING',
        amountPaid: 0,
        transactions: [],
      });
      await job.run(testJobContext(clock.now()));

      // Run 6, 7, 8: 3 more consecutive failed runs at a later time
      clock.advance(10 * 60_000);
      provider.failNext('getPayment');
      await expect(job.run(testJobContext(clock.now()))).rejects.toThrow();
      provider.failNext('getPayment');
      await expect(job.run(testJobContext(clock.now()))).rejects.toThrow();
      provider.failNext('getPayment');
      await expect(job.run(testJobContext(clock.now()))).rejects.toThrow();

      // New episode alert raised!
      const pfAlerts2 = repo.alertEvents.filter(
        (e) => e.payload.condition === 'PROVIDER_FAILURE',
      );
      expect(pfAlerts2).toHaveLength(2);
    });
  });
});
