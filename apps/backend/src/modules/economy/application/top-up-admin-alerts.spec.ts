import { TopUpAdminAlerts } from './top-up-admin-alerts';
import {
  PayosTopUpRepositoryPort,
  TopUpAdminAlertEvent,
} from './ports/payos-top-up-repository.port';

describe('TopUpAdminAlerts', () => {
  it('enqueues alert event and reports created status accurately', async () => {
    const enqueued: TopUpAdminAlertEvent[] = [];
    const repository: Pick<PayosTopUpRepositoryPort, 'enqueueAdminAlert'> = {
      enqueueAdminAlert: jest
        .fn()
        .mockImplementation(async (event: TopUpAdminAlertEvent) => {
          const isDup = enqueued.some(
            (e) => e.idempotencyKey === event.idempotencyKey,
          );
          if (!isDup) {
            enqueued.push(event);
            return { created: true };
          }
          return { created: false };
        }),
    };

    const fixedDate = new Date('2026-10-15T12:00:00.000Z');
    const alerts = new TopUpAdminAlerts(
      repository,
      () => fixedDate,
      () => 'fixed-uuid-1',
    );

    const first = await alerts.raise('UNCREDITED_AFTER_PAYMENT', 'topup-1', {
      topUpId: '2fb40564-05e2-4496-a043-bb3036001ad1',
      orderCode: 10001,
      amountVnd: 50000,
    });
    expect(first).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toEqual({
      id: 'fixed-uuid-1',
      idempotencyKey: 'topup-alert:UNCREDITED_AFTER_PAYMENT:topup-1',
      eventType: 'ECONOMY_TOPUP_ADMIN_ALERT',
      producer: 'economy-service',
      aggregateType: 'TopUpAdminAlert',
      aggregateId: '2fb40564-05e2-4496-a043-bb3036001ad1',
      aggregateVersion: 1,
      payload: {
        schemaVersion: 1,
        condition: 'UNCREDITED_AFTER_PAYMENT',
        topUpId: '2fb40564-05e2-4496-a043-bb3036001ad1',
        orderCode: 10001,
        amountVnd: 50000,
        amountPaidVnd: undefined,
        occurredAt: '2026-10-15T12:00:00.000Z',
      },
    });

    const second = await alerts.raise('UNCREDITED_AFTER_PAYMENT', 'topup-1', {
      topUpId: '2fb40564-05e2-4496-a043-bb3036001ad1',
      orderCode: 10001,
    });
    expect(second).toBe(false);
    expect(enqueued).toHaveLength(1);
  });
});
