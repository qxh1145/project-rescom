import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { LedgerService } from './ledger.service';
import { InMemoryPayosTopUpRepository } from '../infrastructure/in-memory-payos-top-up.repository';
import { FakePaymentProvider } from '../infrastructure/fake-payment-provider';
import { PayosTopUpService } from './payos-top-up.service';
import { PAYOS_TEST_CHECKSUM_KEY } from '../../../../test/fixtures/payos-webhook.fixture';

const userId = '2fb40564-05e2-4496-a043-bb3036001ad1';
describe('PayOS admin console', () => {
  const setup = () => {
    const repository = new InMemoryPayosTopUpRepository();
    const service = new PayosTopUpService({
      repository,
      provider: new FakePaymentProvider(PAYOS_TEST_CHECKSUM_KEY),
      unitOfWork: new PassThroughUnitOfWork(),
      ledgerService: new LedgerService(new InMemoryLedgerRepository()),
      appBaseUrl: 'http://localhost',
      limit: 5,
      windowSeconds: 600,
      logger: { warn: jest.fn(), log: jest.fn() },
      now: () => new Date('2026-10-16T17:00:00Z'),
    });
    return { repository, service };
  };
  it('filters VN day inclusive, routes numeric code vs email, counts channels', async () => {
    const { repository, service } = setup();
    repository.userEmails.set(userId, 'User@Example.com');
    const { topUp } = await service.checkout(userId, { amountVnd: 20_000 });
    repository.rows.get(topUp.id)!.createdAt = new Date('2026-10-16T16:59:59Z');
    repository.manualCount = 2;
    expect(
      (
        await service.listForAdmin({
          limit: 10,
          offset: 0,
          from: '2026-10-16',
          to: '2026-10-16',
        })
      ).total,
    ).toBe(1);
    expect(
      (await service.listForAdmin({ limit: 10, offset: 0, from: '2026-10-17' }))
        .total,
    ).toBe(0);
    expect(
      (
        await service.listForAdmin({
          limit: 10,
          offset: 0,
          q: String(topUp.orderCode),
        })
      ).total,
    ).toBe(1);
    expect(
      (await service.listForAdmin({ limit: 10, offset: 0, q: 'EXAMPLE' }))
        .total,
    ).toBe(1);
    const spy = jest.spyOn(repository, 'listForAdmin');
    await service.listForAdmin({ limit: 10, offset: 0, q: '9999999999' });
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ emailContains: '9999999999' }),
    );
    expect(spy.mock.lastCall?.[0]).not.toHaveProperty('orderCode');
    expect(await service.tabCounts()).toEqual({
      payos: 1,
      manual: 2,
      actionRequired: 0,
    });
  });
  it('audits before returning CSV; audit failure returns no CSV', async () => {
    const { repository, service } = setup();
    const input = { from: '2026-10-16', to: '2026-10-17', adminId: userId };
    expect(await service.exportForAdmin(input)).toContain('orderCode');
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: 'AdminTopUpExported',
      payload: { rowCount: 0 },
    });
    jest
      .spyOn(repository, 'recordAdminAudit')
      .mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service.exportForAdmin(input)).rejects.toThrow(
      'audit unavailable',
    );
  });
  it('rejects overflow without audit', async () => {
    const { repository, service } = setup();
    jest
      .spyOn(repository, 'listForExport')
      .mockResolvedValue(new Array(10_001).fill({}));
    await expect(
      service.exportForAdmin({
        from: '2026-10-16',
        to: '2026-10-17',
        adminId: userId,
      }),
    ).rejects.toMatchObject({
      code: 'TOPUP_EXPORT_TOO_LARGE',
      maxRows: 10_000,
    });
    expect(repository.auditEvents).toHaveLength(0);
  });
});
