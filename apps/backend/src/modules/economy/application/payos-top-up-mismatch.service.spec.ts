import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { InMemoryPayosTopUpRepository } from '../infrastructure/in-memory-payos-top-up.repository';
import { FakePaymentProvider } from '../infrastructure/fake-payment-provider';
import {
  buildPaymentLink,
  PAYOS_TEST_CHECKSUM_KEY,
} from '../../../../test/fixtures/payos-webhook.fixture';
import { LedgerService } from './ledger.service';
import { PayosTopUpService } from './payos-top-up.service';

const userId = '2fb40564-05e2-4496-a043-bb3036001ad1';
const adminId = '38802b7a-8bc2-4c19-a6e4-114ed45f649a';

function setup(
  capability: { role: string; status: string } | null = {
    role: 'ADMIN',
    status: 'ACTIVE',
  },
) {
  const repository = new InMemoryPayosTopUpRepository();
  const ledgerRepo = new InMemoryLedgerRepository();
  const provider = new FakePaymentProvider(PAYOS_TEST_CHECKSUM_KEY);
  const service = new PayosTopUpService({
    repository,
    provider,
    unitOfWork: new PassThroughUnitOfWork(),
    ledgerService: new LedgerService(ledgerRepo),
    adminCapability: {
      findCurrentCapability: async () =>
        capability ? ({ userId: adminId, ...capability } as never) : null,
      listActiveAdminIds: async () => [adminId],
    },
    appBaseUrl: 'http://localhost',
    limit: 5,
    windowSeconds: 600,
    logger: { warn: jest.fn(), log: jest.fn() },
    now: () => new Date('2026-10-16T10:00:00Z'),
  });
  async function mismatch(
    amountPaidVnd = 49_000,
    paidAt = new Date('2026-10-15T03:00:00Z'),
  ) {
    const { topUp } = await service.checkout(userId, { amountVnd: 50_000 });
    const row = repository.rows.get(topUp.id)!;
    row.status = 'AMOUNT_MISMATCH';
    row.amountPaidVnd = amountPaidVnd;
    row.paidAt = paidAt;
    row.counterAccountNumber = '1234567890';
    row.counterAccountName = 'PRIVATE';
    return row;
  }
  return { repository, ledgerRepo, provider, service, mismatch };
}

describe('ResolveTopUpMismatch', () => {
  it('credits floor once, audits once, and masks account in action list', async () => {
    const { repository, ledgerRepo, service, mismatch } = setup();
    const row = await mismatch(98_100);
    const list = await service.listActionRequired();
    expect(JSON.stringify(list)).not.toContain('1234567890');
    expect(JSON.stringify(list)).not.toContain('PRIVATE');
    expect(list.mismatches[0]).toMatchObject({ counterAccountLast4: '7890' });
    const body = { action: 'CREDIT' as const, expectedAmountPaidVnd: 98_100 };
    expect(
      await service.resolveMismatch(row.id, body, { adminId }),
    ).toMatchObject({
      status: 'SUCCESSFUL',
      pointsCredited: 490,
      replayed: false,
    });
    expect(
      await service.resolveMismatch(row.id, body, { adminId }),
    ).toMatchObject({ replayed: true });
    expect(repository.auditEvents).toHaveLength(1);
    expect(repository.auditEvents[0]).toMatchObject({
      idempotencyKey: `admin-audit:topup-mismatch:${row.id}`,
      payload: { resolution: 'CREDIT', pointsCredited: 490, adminId },
    });
    expect(repository.events.at(-1)).toMatchObject({
      idempotencyKey: `topup-mismatch:${row.id}`,
      payload: { points: 490, remainderVnd: 100, resolution: 'ADMIN_CREDIT' },
    });
    expect(
      (await ledgerRepo.findJournalByIdempotencyKey(`topup-mismatch:${row.id}`))
        ?.id,
    ).toBe(row.journalId);
    await expect(
      service.resolveMismatch(
        row.id,
        {
          action: 'MANUAL_REFUND',
          expectedAmountPaidVnd: 98_100,
          note: 'paid',
        },
        { adminId },
      ),
    ).rejects.toMatchObject({ code: 'TOPUP_MISMATCH_ALREADY_RESOLVED' });
  });

  it('refunds without journal, hides note in events and returns replay', async () => {
    const { repository, ledgerRepo, service, mismatch } = setup();
    const row = await mismatch();
    const body = {
      action: 'MANUAL_REFUND' as const,
      expectedAmountPaidVnd: 49_000,
      note: 'bank private',
    };
    expect(
      await service.resolveMismatch(row.id, body, { adminId }),
    ).toMatchObject({
      status: 'MANUAL_REFUNDED',
      pointsCredited: null,
      replayed: false,
    });
    expect(
      await service.resolveMismatch(row.id, body, { adminId }),
    ).toMatchObject({ replayed: true });
    expect(row.resolutionNote).toBe('bank private');
    expect(
      JSON.stringify(repository.events) +
        JSON.stringify(repository.auditEvents),
    ).not.toContain('bank private');
    expect(repository.auditEvents).toHaveLength(1);
    expect(
      await ledgerRepo.findJournalByIdempotencyKey(`topup-mismatch:${row.id}`),
    ).toBeNull();
    await expect(
      service.resolveMismatch(
        row.id,
        { action: 'CREDIT', expectedAmountPaidVnd: 49_000 },
        { adminId },
      ),
    ).rejects.toMatchObject({ code: 'TOPUP_MISMATCH_ALREADY_RESOLVED' });
  });

  it('returns 404 for non-PayOS rows', async () => {
    const { repository, service, mismatch } = setup();
    const row = await mismatch();
    jest
      .spyOn(repository, 'lockForUpdate')
      .mockResolvedValueOnce({ ...row, channel: 'MANUAL' } as typeof row);
    await expect(
      service.resolveMismatch(
        row.id,
        { action: 'CREDIT', expectedAmountPaidVnd: 49_000 },
        { adminId },
      ),
    ).rejects.toMatchObject({ code: 'TOPUP_NOT_FOUND' });
  });

  it('rejects stale amounts, amounts below one Point, and inactive/self actors', async () => {
    const { repository, service, mismatch } = setup();
    const row = await mismatch(150);
    await expect(
      service.resolveMismatch(
        row.id,
        { action: 'CREDIT', expectedAmountPaidVnd: 49_000 },
        { adminId },
      ),
    ).rejects.toMatchObject({
      code: 'TOPUP_MISMATCH_AMOUNT_CHANGED',
      amountPaidVnd: 150,
    });
    await expect(
      service.resolveMismatch(
        row.id,
        { action: 'CREDIT', expectedAmountPaidVnd: 150 },
        { adminId },
      ),
    ).rejects.toMatchObject({ code: 'TOPUP_MISMATCH_NOTHING_TO_CREDIT' });
    await expect(
      service.resolveMismatch(
        row.id,
        { action: 'MANUAL_REFUND', expectedAmountPaidVnd: 150, note: 'x' },
        { adminId: userId },
      ),
    ).rejects.toMatchObject({ code: 'TOPUP_SELF_REVIEW_FORBIDDEN' });
    expect(repository.auditEvents).toHaveLength(0);
  });

  it.each([
    ['non-ADMIN', { role: 'PUBLISHER', status: 'ACTIVE' }],
    ['inactive', { role: 'ADMIN', status: 'SUSPENDED' }],
    ['missing', null],
  ])('rejects a %s capability without side effects', async (_, capability) => {
    const { repository, service, mismatch } = setup(capability);
    const row = await mismatch();
    await expect(
      service.resolveMismatch(
        row.id,
        { action: 'CREDIT', expectedAmountPaidVnd: 49_000 },
        { adminId },
      ),
    ).rejects.toMatchObject({ code: 'TOPUP_ADMIN_CAPABILITY_REQUIRED' });
    expect(row.status).toBe('AMOUNT_MISMATCH');
    expect(repository.auditEvents).toHaveLength(0);
  });

  it('sorts mismatches by resolveDueAt and lists only live uncredited alerts', async () => {
    const { repository, service, mismatch } = setup();
    const later = await mismatch(49_000, new Date('2026-10-15T03:00:00Z'));
    const earlier = await mismatch(98_000, new Date('2026-10-09T03:00:00Z'));
    const stale = await mismatch();
    stale.status = 'PROCESSING';
    for (const id of [stale.id, later.id])
      repository.alertEvents.push({
        id: `alert-${id}`,
        idempotencyKey: `topup-alert:UNCREDITED_AFTER_PAYMENT:${id}`,
        eventType: 'ECONOMY_TOPUP_ADMIN_ALERT',
        producer: 'economy-service',
        aggregateType: 'TopUpRequest',
        aggregateId: id,
        aggregateVersion: 1,
        payload: { paidAt: '2026-10-16T09:00:00.000Z' },
      });
    const list = await service.listActionRequired();
    // Thu 15/10 + 3 business days = Tue 20/10; Fri 09/10 + 3 = Wed 14/10.
    expect(
      list.mismatches.map((row) => [row.id, row.resolveDueAt]),
    ).toEqual([
      [earlier.id, '2026-10-14T03:00:00.000Z'],
      [later.id, '2026-10-20T03:00:00.000Z'],
    ]);
    expect(list.uncredited.map((row) => row.topUpId)).toEqual([stale.id]);
    expect(await service.tabCounts()).toMatchObject({ actionRequired: 3 });
  });

  it('recheck reports REFUNDED and keeps a refunded row closed', async () => {
    const { ledgerRepo, provider, service, mismatch } = setup();
    const row = await mismatch();
    await service.resolveMismatch(
      row.id,
      { action: 'MANUAL_REFUND', expectedAmountPaidVnd: 49_000, note: 'done' },
      { adminId },
    );
    provider.setPayment(
      row.orderCode,
      buildPaymentLink({
        orderCode: row.orderCode,
        id: String(row.orderCode),
        status: 'PAID',
        amountPaid: row.amountVnd,
      }),
    );
    expect(
      await service.recheck({ topUpId: row.id, adminId }),
    ).toMatchObject({ result: 'REFUNDED', status: 'MANUAL_REFUNDED' });
    expect(
      await ledgerRepo.findJournalByIdempotencyKey(`topup-credit:${row.id}`),
    ).toBeNull();
  });
});
