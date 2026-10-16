import { InMemoryPayosTopUpRepository } from './in-memory-payos-top-up.repository';
import {
  PayosTopUp,
  TopUpAdminAlertEvent,
  TopUpAdminAuditEvent,
  TopUpStatusEvent,
} from '../application/ports/payos-top-up-repository.port';

describe('InMemoryPayosTopUpRepository - Task 3', () => {
  let repo: InMemoryPayosTopUpRepository;
  const now = new Date('2026-10-15T12:00:00.000Z');

  beforeEach(() => {
    repo = new InMemoryPayosTopUpRepository();
  });

  function makeTopUp(
    partial: Partial<PayosTopUp> & { id: string },
  ): PayosTopUp {
    return {
      userId: 'user-1',
      orderCode: 123456,
      amountVnd: 20000,
      points: 100,
      status: 'PROCESSING',
      checkoutUrl: null,
      paymentLinkId: null,
      expiresAt: new Date(now.getTime() + 5 * 60_000),
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
      createdAt: now,
      ...partial,
    };
  }

  describe('listReconcileCandidates', () => {
    it('returns PROCESSING and AMOUNT_MISMATCH regardless of age', async () => {
      repo.rows.set('p1', makeTopUp({ id: 'p1', status: 'PROCESSING' }));
      repo.rows.set('m1', makeTopUp({ id: 'm1', status: 'AMOUNT_MISMATCH' }));

      const res = await repo.listReconcileCandidates({ now, limit: 10 });
      expect(res.map((r) => r.id)).toEqual(['m1', 'p1']);
    });

    it('filters CANCELLED and EXPIRED by 24h window', async () => {
      const within24h = new Date(now.getTime() - 23 * 3600_000);
      const past24h = new Date(now.getTime() - 25 * 3600_000);

      repo.rows.set(
        'c-recent',
        makeTopUp({
          id: 'c-recent',
          status: 'CANCELLED',
          cancelledAt: within24h,
        }),
      );
      repo.rows.set(
        'c-old',
        makeTopUp({ id: 'c-old', status: 'CANCELLED', cancelledAt: past24h }),
      );
      repo.rows.set(
        'e-recent',
        makeTopUp({ id: 'e-recent', status: 'EXPIRED', expiresAt: within24h }),
      );
      repo.rows.set(
        'e-old',
        makeTopUp({ id: 'e-old', status: 'EXPIRED', expiresAt: past24h }),
      );

      const res = await repo.listReconcileCandidates({ now, limit: 10 });
      expect(res.map((r) => r.id)).toEqual(['c-recent', 'e-recent']);
    });

    it('keyset pagination with after and limit', async () => {
      repo.rows.set('1', makeTopUp({ id: '1', status: 'PROCESSING' }));
      repo.rows.set('2', makeTopUp({ id: '2', status: 'PROCESSING' }));
      repo.rows.set('3', makeTopUp({ id: '3', status: 'PROCESSING' }));

      const page1 = await repo.listReconcileCandidates({ now, limit: 2 });
      expect(page1.map((r) => r.id)).toEqual(['1', '2']);

      const page2 = await repo.listReconcileCandidates({
        now,
        after: page1[1].id,
        limit: 2,
      });
      expect(page2.map((r) => r.id)).toEqual(['3']);
    });
  });

  describe('findPayosById', () => {
    it('returns the row by id', async () => {
      const row = makeTopUp({ id: 'test-id' });
      repo.rows.set('test-id', row);
      expect(await repo.findPayosById('test-id')).toEqual(row);
      expect(await repo.findPayosById('unknown')).toBeNull();
    });
  });

  describe('markExpired', () => {
    it('transitions PROCESSING to EXPIRED and appends outbox event', async () => {
      repo.rows.set('p1', makeTopUp({ id: 'p1', status: 'PROCESSING' }));
      const event: TopUpStatusEvent = {
        id: 'evt-1',
        idempotencyKey: 'key-1',
        eventType: 'ECONOMY_TOPUP_STATUS_CHANGED',
        producer: 'test',
        aggregateType: 'TOPUP',
        aggregateId: 'p1',
        aggregateVersion: 2,
        payload: {
          schemaVersion: 1,
          topUpId: 'p1',
          userId: 'user-1',
          orderCode: 123456,
          amountVnd: 20000,
          points: 100,
          status: 'EXPIRED',
          occurredAt: now.toISOString(),
        },
      };

      const res = await repo.markExpired('p1', now, event);
      expect(res.changed).toBe(true);
      expect(repo.rows.get('p1')!.status).toBe('EXPIRED');
      expect(repo.rows.get('p1')!.cancelledAt).toBeNull();
      expect(repo.events).toContainEqual(event);
    });

    it('no-ops if row is not PROCESSING', async () => {
      repo.rows.set('c1', makeTopUp({ id: 'c1', status: 'CANCELLED' }));
      const event: TopUpStatusEvent = {
        id: 'evt-2',
        idempotencyKey: 'key-2',
        eventType: 'ECONOMY_TOPUP_STATUS_CHANGED',
        producer: 'test',
        aggregateType: 'TOPUP',
        aggregateId: 'c1',
        aggregateVersion: 2,
        payload: {
          schemaVersion: 1,
          topUpId: 'c1',
          userId: 'user-1',
          orderCode: 123456,
          amountVnd: 20000,
          points: 100,
          status: 'EXPIRED',
          occurredAt: now.toISOString(),
        },
      };

      const res = await repo.markExpired('c1', now, event);
      expect(res.changed).toBe(false);
      expect(repo.rows.get('c1')!.status).toBe('CANCELLED');
    });
  });

  describe('markAmountMismatch (C3 refresh)', () => {
    it('refreshes amountPaidVnd and preserves original paidAt when already AMOUNT_MISMATCH', async () => {
      const originalPaidAt = new Date('2026-10-15T10:00:00.000Z');
      repo.rows.set(
        'm1',
        makeTopUp({
          id: 'm1',
          status: 'AMOUNT_MISMATCH',
          amountPaidVnd: 5000,
          paidAt: originalPaidAt,
          providerReference: 'ref-old',
        }),
      );

      const event: TopUpStatusEvent = {
        id: 'evt-3',
        idempotencyKey: 'key-3',
        eventType: 'ECONOMY_TOPUP_STATUS_CHANGED',
        producer: 'test',
        aggregateType: 'TOPUP',
        aggregateId: 'm1',
        aggregateVersion: 2,
        payload: {
          schemaVersion: 1,
          topUpId: 'm1',
          userId: 'user-1',
          orderCode: 123456,
          amountVnd: 20000,
          points: 100,
          status: 'AMOUNT_MISMATCH',
          amountPaidVnd: 10000,
          occurredAt: now.toISOString(),
        },
      };

      const res = await repo.markAmountMismatch(
        'm1',
        {
          facts: {
            amountPaidVnd: 10000,
            providerReference: 'ref-new',
            paidAt: new Date('2026-10-15T11:00:00.000Z'),
            counterAccountBankId: null,
            counterAccountBankName: null,
            counterAccountName: null,
            counterAccountNumber: null,
          },
          verifiedAt: now,
        },
        event,
      );

      expect(res.changed).toBe(true);
      const updated = repo.rows.get('m1')!;
      expect(updated.amountPaidVnd).toBe(10000);
      expect(updated.providerReference).toBe('ref-new');
      expect(updated.paidAt).toEqual(originalPaidAt);
    });

    it('returns changed: false when amountPaidVnd has not changed', async () => {
      repo.rows.set(
        'm1',
        makeTopUp({
          id: 'm1',
          status: 'AMOUNT_MISMATCH',
          amountPaidVnd: 5000,
        }),
      );

      const event = {} as TopUpStatusEvent;
      const res = await repo.markAmountMismatch(
        'm1',
        {
          facts: {
            amountPaidVnd: 5000,
            providerReference: 'ref-same',
            paidAt: now,
            counterAccountBankId: null,
            counterAccountBankName: null,
            counterAccountName: null,
            counterAccountNumber: null,
          },
          verifiedAt: now,
        },
        event,
      );

      expect(res.changed).toBe(false);
    });
  });

  describe('enqueueAdminAlert & recordAdminAudit', () => {
    it('ignores duplicate alert by idempotencyKey', async () => {
      const alert: TopUpAdminAlertEvent = {
        id: 'alt-1',
        idempotencyKey: 'topup-alert:MISMATCH_SLA:m1',
        eventType: 'ECONOMY_TOPUP_ADMIN_ALERT',
        producer: 'test',
        aggregateType: 'TOPUP',
        aggregateId: 'm1',
        aggregateVersion: 1,
        payload: {},
      };

      const first = await repo.enqueueAdminAlert(alert);
      expect(first.created).toBe(true);

      const second = await repo.enqueueAdminAlert(alert);
      expect(second.created).toBe(false);
      expect(repo.alertEvents.length).toBe(1);
    });

    it('records admin audit events', async () => {
      const audit: TopUpAdminAuditEvent = {
        id: 'aud-1',
        idempotencyKey: 'admin-audit:topup-recheck:1:uuid',
        eventType: 'AdminTopUpRechecked',
        producer: 'test',
        aggregateType: 'TOPUP',
        aggregateId: '1',
        aggregateVersion: 1,
        payload: { action: 'TOPUP_RECHECKED' },
      };

      await repo.recordAdminAudit(audit);
      expect(repo.auditEvents).toContainEqual(audit);
    });
  });
});
