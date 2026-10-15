import { PayosTopUpService } from './payos-top-up.service';
import { InMemoryPayosTopUpRepository } from '../infrastructure/in-memory-payos-top-up.repository';
import { FakePaymentProvider } from '../infrastructure/fake-payment-provider';

const userId = '2fb40564-05e2-4496-a043-bb3036001ad1';
describe('PayosTopUpService', () => {
  it('commits processing before provider, computes points, cancels once and allows retry', async () => {
    const repository = new InMemoryPayosTopUpRepository();
    const provider = new FakePaymentProvider('test');
    const create = provider.createPayment.bind(provider);
    provider.createPayment = async (input) => {
      expect(
        [...repository.rows.values()].find(
          (row) => row.orderCode === input.orderCode,
        )?.status,
      ).toBe('PROCESSING');
      return create(input);
    };
    const service = new PayosTopUpService({
      repository,
      provider,
      appBaseUrl: 'http://localhost:3000/',
      limit: 5,
      windowSeconds: 600,
      logger: { warn: jest.fn() },
    });
    const first = await service.checkout(userId, {
      amountVnd: 10_000,
      points: 999999,
    });
    expect(first.topUp.points).toBe(50);
    expect(first.topUp.checkoutUrl).toBe(first.checkoutUrl);
    expect(repository.rows.get(first.topUp.id)?.paymentLinkId).toBe(
      String(first.topUp.orderCode),
    );
    expect(first.topUp.expiresAt).toBe(
      new Date(provider.createCalls[0].expiresAt).toISOString(),
    );
    expect(
      new Date(first.topUp.expiresAt).getTime() -
        new Date(first.topUp.createdAt).getTime(),
    ).toBe(300_000);
    expect(provider.createCalls[0].returnUrl).toBe(
      `http://localhost:3000/wallet/top-up/${first.topUp.id}`,
    );
    expect(provider.createCalls[0].cancelUrl).toBe(
      provider.createCalls[0].returnUrl,
    );
    await expect(
      service.checkout(userId, { amountVnd: 10_000 }),
    ).rejects.toMatchObject({
      code: 'TOPUP_ALREADY_PROCESSING',
      topUpId: first.topUp.id,
      checkoutUrl: first.checkoutUrl,
    });
    expect((await service.cancel(userId, first.topUp.id)).status).toBe(
      'CANCELLED',
    );
    await service.cancel(userId, first.topUp.id);
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0].idempotencyKey).toBe(
      `topup-cancel:${first.topUp.id}`,
    );
    expect(
      (await service.checkout(userId, { amountVnd: 10_000 })).topUp.status,
    ).toBe('PROCESSING');
  });
  it('cancels despite provider failure, hides other users, and rejects successful rows', async () => {
    const repository = new InMemoryPayosTopUpRepository();
    const provider = new FakePaymentProvider('test');
    const warn = jest.fn();
    const service = new PayosTopUpService({
      repository,
      provider,
      appBaseUrl: 'http://localhost',
      limit: 5,
      windowSeconds: 600,
      logger: { warn },
    });
    const { topUp } = await service.checkout(userId, { amountVnd: 10_000 });
    await expect(
      service.cancel('9c133c42-26b4-447d-b4cf-01551145d098', topUp.id),
    ).rejects.toMatchObject({ code: 'TOPUP_NOT_FOUND' });
    expect(provider.cancelCalls).toHaveLength(0);
    provider.failNext('cancelPayment');
    expect((await service.cancel(userId, topUp.id)).status).toBe('CANCELLED');
    expect(warn).toHaveBeenCalled();
    expect(repository.events).toHaveLength(1);
    const next = await service.checkout(userId, { amountVnd: 10_000 });
    repository.rows.get(next.topUp.id)!.status = 'SUCCESSFUL';
    await expect(service.cancel(userId, next.topUp.id)).rejects.toMatchObject({
      code: 'TOPUP_NOT_CANCELLABLE',
      currentStatus: 'SUCCESSFUL',
    });
    expect(
      (await service.getOwned(userId, next.topUp.id)).checkoutUrl,
    ).toBeNull();
  });
  it('blocks sixth checkout within ten minutes and permits another after window', async () => {
    const repository = new InMemoryPayosTopUpRepository();
    const provider = new FakePaymentProvider('test');
    let now = new Date('2026-10-15T00:00:00.000Z');
    const service = new PayosTopUpService({
      repository,
      provider,
      appBaseUrl: 'http://localhost',
      limit: 5,
      windowSeconds: 600,
      logger: { warn: jest.fn() },
      now: () => now,
    });
    for (let index = 0; index < 5; index++) {
      const { topUp } = await service.checkout(userId, { amountVnd: 10_000 });
      await service.cancel(userId, topUp.id);
      now = new Date(now.getTime() + 1000);
    }
    await expect(
      service.checkout(userId, { amountVnd: 10_000 }),
    ).rejects.toMatchObject({
      code: 'TOPUP_CHECKOUT_RATE_LIMITED',
      retryAfterSeconds: 595,
    });
    expect(provider.createCalls).toHaveLength(5);
    now = new Date(now.getTime() + 600_001);
    await expect(
      service.checkout(userId, { amountVnd: 10_000 }),
    ).resolves.toHaveProperty('topUp.status', 'PROCESSING');
  });
  it('marks failed create cancelled without notification, enforces window', async () => {
    const repository = new InMemoryPayosTopUpRepository();
    const provider = new FakePaymentProvider('test');
    let now = new Date('2026-10-15T00:00:00.000Z');
    const service = new PayosTopUpService({
      repository,
      provider,
      appBaseUrl: 'http://localhost',
      limit: 1,
      windowSeconds: 600,
      logger: { warn: jest.fn() },
      now: () => now,
    });
    provider.failNext('createPayment');
    await expect(
      service.checkout(userId, { amountVnd: 10_000 }),
    ).rejects.toMatchObject({ code: 'TOPUP_PROVIDER_UNAVAILABLE' });
    expect([...repository.rows.values()][0].status).toBe('CANCELLED');
    expect(repository.events).toHaveLength(0);
    await expect(
      service.checkout(userId, { amountVnd: 10_000 }),
    ).rejects.toMatchObject({ code: 'TOPUP_CHECKOUT_RATE_LIMITED' });
    now = new Date('2026-10-15T00:10:01.000Z');
    expect(
      (await service.checkout(userId, { amountVnd: 10_000 })).topUp.status,
    ).toBe('PROCESSING');
  });
  it('cancels the link and the row when storing the link fails', async () => {
    const repository = new InMemoryPayosTopUpRepository();
    const provider = new FakePaymentProvider('test');
    repository.attachPaymentLink = () => Promise.reject(new Error('db down'));
    const warn = jest.fn();
    const service = new PayosTopUpService({
      repository,
      provider,
      appBaseUrl: 'http://localhost',
      limit: 5,
      windowSeconds: 600,
      logger: { warn },
    });
    await expect(
      service.checkout(userId, { amountVnd: 10_000 }),
    ).rejects.toMatchObject({ code: 'TOPUP_PROVIDER_UNAVAILABLE' });
    const row = [...repository.rows.values()][0];
    expect(row.status).toBe('CANCELLED');
    expect(provider.cancelCalls).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      'payOS link attach failed',
      expect.objectContaining({ topUpId: row.id, cancelled: true }),
    );
  });
  it('lists owned top-ups with pagination, correct ordering and excludes other users', async () => {
    const repository = new InMemoryPayosTopUpRepository();
    const provider = new FakePaymentProvider('test');
    const service = new PayosTopUpService({
      repository,
      provider,
      appBaseUrl: 'http://localhost',
      limit: 10,
      windowSeconds: 600,
      logger: { warn: jest.fn() },
    });
    const otherUser = '77777777-7777-4777-8777-777777777777';
    await service.checkout(otherUser, { amountVnd: 10_000 });
    const userRow1 = await service.checkout(userId, { amountVnd: 10_000 });
    await service.cancel(userId, userRow1.topUp.id);
    const userRow2 = await service.checkout(userId, { amountVnd: 20_000 });

    const list1 = await service.listOwned(userId, { limit: 1, offset: 0 });
    expect(list1.total).toBe(2);
    expect(list1.items).toHaveLength(1);
    expect(list1.items[0].id).toBe(userRow2.topUp.id);
    expect(list1.hasMore).toBe(true);

    const list2 = await service.listOwned(userId, { limit: 1, offset: 1 });
    expect(list2.items).toHaveLength(1);
    expect(list2.items[0].id).toBe(userRow1.topUp.id);
    expect(list2.hasMore).toBe(false);

    const otherList = await service.listOwned(otherUser, { limit: 10, offset: 0 });
    expect(otherList.total).toBe(1);
  });
});

