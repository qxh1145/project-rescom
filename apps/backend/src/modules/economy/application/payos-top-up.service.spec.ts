import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { LedgerService } from './ledger.service';
import {
  buildPaymentLink,
  buildPayosWebhookData,
  signPayosWebhook,
  PAYOS_TEST_CHECKSUM_KEY,
} from '../../../../test/fixtures/payos-webhook.fixture';
import { PayosTopUpService } from './payos-top-up.service';
import { InMemoryPayosTopUpRepository } from '../infrastructure/in-memory-payos-top-up.repository';
import { FakePaymentProvider } from '../infrastructure/fake-payment-provider';
import {
  PaymentProviderSignatureError,
  PaymentProviderUnavailableError,
} from './ports/payment-provider.port';

const userId = '2fb40564-05e2-4496-a043-bb3036001ad1';
describe('PayosTopUpService webhook', () => {
  function setup() {
    const repository = new InMemoryPayosTopUpRepository();
    const provider = new FakePaymentProvider(PAYOS_TEST_CHECKSUM_KEY);
    const ledger = new LedgerService(new InMemoryLedgerRepository());
    const logger = { warn: jest.fn(), log: jest.fn() };
    const service = new PayosTopUpService({
      repository,
      provider,
      unitOfWork: new PassThroughUnitOfWork(),
      ledgerService: ledger,
      appBaseUrl: 'http://localhost',
      limit: 5,
      windowSeconds: 600,
      logger,
    });
    return { repository, provider, ledger, service, logger };
  }
  it('requires verified signature and server GET, credits exactly once, permits late payment', async () => {
    const { repository, provider, ledger, service } = setup();
    const { topUp } = await service.checkout(userId, { amountVnd: 20_000 });
    provider.setPayment(
      topUp.orderCode,
      buildPaymentLink({
        orderCode: topUp.orderCode,
        id: String(topUp.orderCode),
      }),
    );
    const data = buildPayosWebhookData({
      orderCode: topUp.orderCode,
      paymentLinkId: String(topUp.orderCode),
      amount: 1,
    });
    await expect(
      service.handleWebhook({ ...signPayosWebhook(data), signature: 'bad' }),
    ).rejects.toBeInstanceOf(PaymentProviderSignatureError);
    expect(repository.rows.get(topUp.id)?.status).toBe('PROCESSING');
    await service.cancel(userId, topUp.id);
    expect(await service.handleWebhook(signPayosWebhook(data))).toEqual({
      outcome: 'APPLIED',
    });
    expect(await service.handleWebhook(signPayosWebhook(data))).toEqual({
      outcome: 'IGNORED',
    });
    expect(repository.rows.get(topUp.id)).toMatchObject({
      status: 'SUCCESSFUL',
      pointsCredited: 100,
      amountPaidVnd: 20_000,
    });
    const successEvents = repository.events.filter(
      (event) => event.payload.status === 'SUCCESSFUL',
    );
    expect(successEvents).toHaveLength(1);
    expect(successEvents[0]).toMatchObject({
      idempotencyKey: `topup-credit:${topUp.id}`,
      aggregateVersion: 3,
    });
    const journal = await ledger.creditPayosTopUp({
      topUpId: topUp.id,
      userId,
      points: 100,
      orderCode: topUp.orderCode,
    });
    await expect(
      ledger.reverseJournal({ targetJournalId: journal.id }),
    ).rejects.toThrow('Top-up credit journals cannot be reversed');
  });
  it('ignores invalid orders, link mismatch and non-success webhook without server GET', async () => {
    const { repository, provider, service, logger } = setup();
    const getPayment = jest.spyOn(provider, 'getPayment');
    const { topUp } = await service.checkout(userId, { amountVnd: 20_000 });
    const data = buildPayosWebhookData({
      orderCode: topUp.orderCode,
      paymentLinkId: String(topUp.orderCode),
    });
    for (const body of [
      null,
      {},
      { ...signPayosWebhook(data), data: { ...data, amount: 1 } },
    ])
      await expect(service.handleWebhook(body)).rejects.toBeInstanceOf(
        PaymentProviderSignatureError,
      );
    expect(
      await service.handleWebhook(
        signPayosWebhook(
          buildPayosWebhookData({ orderCode: topUp.orderCode + 77 }),
        ),
      ),
    ).toEqual({ outcome: 'IGNORED' });
    expect(
      await service.handleWebhook(
        signPayosWebhook({ ...data, paymentLinkId: 'wrong' }),
      ),
    ).toEqual({ outcome: 'IGNORED' });
    expect(
      await service.handleWebhook({ ...signPayosWebhook(data), code: '01' }),
    ).toEqual({ outcome: 'IGNORED' });
    expect(
      await service.handleWebhook(signPayosWebhook({ ...data, code: '01' })),
    ).toEqual({ outcome: 'IGNORED' });
    expect(getPayment).not.toHaveBeenCalled();
    expect(repository.events).toHaveLength(0);
    provider.setPayment(
      topUp.orderCode,
      buildPaymentLink({
        orderCode: topUp.orderCode,
        id: String(topUp.orderCode),
        status: 'PENDING',
        amountPaid: 0,
      }),
    );
    expect(await service.handleWebhook(signPayosWebhook(data))).toEqual({
      outcome: 'IGNORED',
    });
    expect(logger.log).toHaveBeenCalledWith(
      'payOS payment not yet paid',
      expect.objectContaining({ orderCode: topUp.orderCode }),
    );
    provider.failNext('getPayment');
    await expect(
      service.handleWebhook(signPayosWebhook(data)),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    expect(repository.rows.get(topUp.id)?.status).toBe('PROCESSING');
    expect(repository.events).toHaveLength(0);
  });
  it('ignores paid cancelled links, manual-refunded rows, and accepts expired late payment', async () => {
    const { repository, provider, service, logger } = setup();
    const getPayment = jest.spyOn(provider, 'getPayment');
    const { topUp } = await service.checkout(userId, { amountVnd: 20_000 });
    const data = buildPayosWebhookData({
      orderCode: topUp.orderCode,
      paymentLinkId: String(topUp.orderCode),
    });
    provider.setPayment(
      topUp.orderCode,
      buildPaymentLink({
        orderCode: topUp.orderCode,
        id: String(topUp.orderCode),
        status: 'CANCELLED',
        amountPaid: 5000,
      }),
    );
    expect(await service.handleWebhook(signPayosWebhook(data))).toEqual({
      outcome: 'IGNORED',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'payOS reports paid amount on a cancelled/expired link',
      expect.objectContaining({ orderCode: topUp.orderCode }),
    );
    repository.rows.get(topUp.id)!.status = 'MANUAL_REFUNDED';
    provider.setPayment(
      topUp.orderCode,
      buildPaymentLink({
        orderCode: topUp.orderCode,
        id: String(topUp.orderCode),
      }),
    );
    getPayment.mockClear();
    expect(await service.handleWebhook(signPayosWebhook(data))).toEqual({
      outcome: 'IGNORED',
    });
    expect(getPayment).not.toHaveBeenCalled();
    const paid = await provider.getPayment(topUp.orderCode, topUp.amountVnd);
    expect(await service.creditTopUp(topUp.id, paid)).toEqual({
      outcome: 'IGNORED',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'payOS verified payment not credited',
      { orderCode: topUp.orderCode, status: 'MANUAL_REFUNDED' },
    );
    repository.rows.get(topUp.id)!.status = 'EXPIRED';
    provider.setPayment(
      topUp.orderCode,
      buildPaymentLink({
        orderCode: topUp.orderCode,
        id: String(topUp.orderCode),
        transactions: [
          {
            ...buildPaymentLink().transactions[0],
            counterAccountBankId: null,
            counterAccountBankName: null,
            counterAccountName: null,
            counterAccountNumber: null,
          },
        ],
      }),
    );
    expect(await service.handleWebhook(signPayosWebhook(data))).toEqual({
      outcome: 'APPLIED',
    });
    expect(repository.rows.get(topUp.id)).toMatchObject({
      status: 'SUCCESSFUL',
      counterAccountBankId: null,
      counterAccountBankName: null,
      counterAccountName: null,
      counterAccountNumber: null,
    });
  });
  it('records amount mismatch without credit, then credits full verified payment', async () => {
    const { repository, provider, service } = setup();
    const { topUp } = await service.checkout(userId, { amountVnd: 20_000 });
    const data = buildPayosWebhookData({
      orderCode: topUp.orderCode,
      paymentLinkId: String(topUp.orderCode),
    });
    provider.setPayment(
      topUp.orderCode,
      buildPaymentLink({
        orderCode: topUp.orderCode,
        id: String(topUp.orderCode),
        amountPaid: 10_000,
        status: 'UNDERPAID',
      }),
    );
    expect(await service.handleWebhook(signPayosWebhook(data))).toEqual({
      outcome: 'APPLIED',
    });
    expect(repository.rows.get(topUp.id)).toMatchObject({
      status: 'AMOUNT_MISMATCH',
      amountPaidVnd: 10_000,
    });
    expect(repository.events.at(-1)?.idempotencyKey).toBe(
      `topup-mismatch-notice:${topUp.id}:10000`,
    );
    expect(repository.rows.get(topUp.id)?.pointsCredited).toBeNull();
    provider.setPayment(
      topUp.orderCode,
      buildPaymentLink({
        orderCode: topUp.orderCode,
        id: String(topUp.orderCode),
      }),
    );
    expect(await service.handleWebhook(signPayosWebhook(data))).toEqual({
      outcome: 'APPLIED',
    });
    expect(repository.rows.get(topUp.id)?.status).toBe('SUCCESSFUL');
    expect(repository.rows.get(topUp.id)).toMatchObject({
      counterAccountBankId: '970436',
      counterAccountBankName: 'Vietcombank',
      counterAccountNumber: '123456',
    });
  });
});
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
      unitOfWork: new PassThroughUnitOfWork(),
      ledgerService: new LedgerService(new InMemoryLedgerRepository()),
      appBaseUrl: 'http://localhost:3000/',
      limit: 5,
      windowSeconds: 600,
      logger: { warn: jest.fn(), log: jest.fn() },
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
      unitOfWork: new PassThroughUnitOfWork(),
      ledgerService: new LedgerService(new InMemoryLedgerRepository()),
      appBaseUrl: 'http://localhost',
      limit: 5,
      windowSeconds: 600,
      logger: { warn, log: jest.fn() },
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
      unitOfWork: new PassThroughUnitOfWork(),
      ledgerService: new LedgerService(new InMemoryLedgerRepository()),
      appBaseUrl: 'http://localhost',
      limit: 5,
      windowSeconds: 600,
      logger: { warn: jest.fn(), log: jest.fn() },
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
      unitOfWork: new PassThroughUnitOfWork(),
      ledgerService: new LedgerService(new InMemoryLedgerRepository()),
      appBaseUrl: 'http://localhost',
      limit: 1,
      windowSeconds: 600,
      logger: { warn: jest.fn(), log: jest.fn() },
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
      unitOfWork: new PassThroughUnitOfWork(),
      ledgerService: new LedgerService(new InMemoryLedgerRepository()),
      appBaseUrl: 'http://localhost',
      limit: 5,
      windowSeconds: 600,
      logger: { warn, log: jest.fn() },
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
    let clock = Date.parse('2026-10-15T00:00:00.000Z');
    const service = new PayosTopUpService({
      repository,
      provider,
      unitOfWork: new PassThroughUnitOfWork(),
      ledgerService: new LedgerService(new InMemoryLedgerRepository()),
      appBaseUrl: 'http://localhost',
      limit: 10,
      windowSeconds: 600,
      logger: { warn: jest.fn(), log: jest.fn() },
      now: () => new Date((clock += 1000)),
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

