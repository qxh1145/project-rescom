import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { createRequire } from 'module';
import { PrismaClient } from '@prisma/client';
import {
  databaseUrl,
  probeDatabase,
  requireDb,
} from './fixtures/financial-pg-harness';
import { PrismaService } from '../src/common/database/prisma.service';
import { PrismaUnitOfWork } from '../src/common/database/prisma-unit-of-work';
import { PrismaPayosTopUpRepository } from '../src/modules/economy/infrastructure/prisma-payos-top-up.repository';
import { PrismaLedgerRepository } from '../src/modules/economy/infrastructure/prisma-ledger.repository';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { PayosTopUpService } from '../src/modules/economy/application/payos-top-up.service';
import { FakePaymentProvider } from '../src/modules/economy/infrastructure/fake-payment-provider';
import { PAYOS_TEST_CHECKSUM_KEY } from './fixtures/payos-webhook.fixture';

const available = probeDatabase();
if (!available && requireDb)
  throw new Error('Financial PostgreSQL test database unavailable');

(available ? describe : describe.skip)('PayOS mismatch resolution (DB)', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const db = prisma as PrismaService;
  const repository = new PrismaPayosTopUpRepository(db);
  const adminId = randomUUID();
  const service = new PayosTopUpService({
    repository,
    ledgerService: new LedgerService(new PrismaLedgerRepository(db)),
    unitOfWork: new PrismaUnitOfWork(db),
    provider: new FakePaymentProvider(PAYOS_TEST_CHECKSUM_KEY),
    adminCapability: {
      findCurrentCapability: async () => ({
        userId: adminId,
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
      listActiveAdminIds: async () => [adminId],
    },
    appBaseUrl: 'http://localhost',
    limit: 5,
    windowSeconds: 600,
    logger: { log: jest.fn(), warn: jest.fn() },
  });
  const users: string[] = [];
  async function create() {
    const user = await prisma.user.create({
      data: { email: `mismatch-${randomUUID()}@example.com` },
    });
    users.push(user.id);
    const [code] = await prisma.$queryRaw<
      Array<{ code: number }>
    >`SELECT nextval('top_up_order_code_seq')::int AS code`;
    return prisma.topUpRequest.create({
      data: {
        userId: user.id,
        amount: 250,
        amountVnd: 50_000,
        channel: 'PAYOS',
        orderCode: code.code,
        status: 'AMOUNT_MISMATCH',
        expiresAt: new Date(Date.now() + 300_000),
        amountPaidVnd: 49_000,
        paidAt: new Date(),
      },
    });
  }
  beforeAll(async () => {
    const cli = createRequire(__filename).resolve('prisma/build/index.js', {
      paths: [__dirname],
    });
    execFileSync(
      process.execPath,
      [cli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      {
        cwd: resolve(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      },
    );
    await prisma.$connect();
  });
  afterAll(async () => {
    const rows = await prisma.topUpRequest.findMany({
      where: { userId: { in: users } },
      select: { id: true },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: rows.map((r) => r.id) } },
    });
    await prisma.topUpRequest.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({
      where: { id: { in: users }, ledgerAccounts: { none: {} } },
    });
    await prisma.$disconnect();
  });

  it('lists live uncredited alerts only and counts them after older closed alerts', async () => {
    const closed = await create();
    await prisma.topUpRequest.update({
      where: { id: closed.id },
      data: { status: 'SUCCESSFUL' },
    });
    const open = await create();
    await prisma.topUpRequest.update({
      where: { id: open.id },
      data: { status: 'PROCESSING' },
    });
    for (const row of [closed, open]) {
      await prisma.outboxEvent.create({
        data: {
          idempotencyKey: `topup-alert:UNCREDITED_AFTER_PAYMENT:${row.id}`,
          eventType: 'ECONOMY_TOPUP_ADMIN_ALERT',
          schemaVersion: 1,
          producer: 'economy-service',
          aggregateType: 'TopUpAdminAlert',
          aggregateId: row.id,
          aggregateVersion: 1,
          payload: {
            schemaVersion: 1,
            condition: 'UNCREDITED_AFTER_PAYMENT',
            paidAt: row.paidAt?.toISOString(),
            amountPaidVnd: 49_000,
            occurredAt: new Date().toISOString(),
          },
        },
      });
    }
    const list = await repository.listActionRequired({ limit: 1 });
    expect(list.uncredited).toHaveLength(1);
    expect(list.uncredited[0].topUpId).toBe(open.id);
    expect(list.uncredited[0].paidAt).toBe(open.paidAt?.toISOString());
    expect(await repository.countActionRequired()).toBeGreaterThanOrEqual(1);
  });

  it('serializes two credits and emits exactly one audit/journal', async () => {
    const row = await create();
    const body = { action: 'CREDIT' as const, expectedAmountPaidVnd: 49_000 };
    const results = await Promise.all([
      service.resolveMismatch(row.id, body, { adminId }),
      service.resolveMismatch(row.id, body, { adminId }),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    const final = await prisma.topUpRequest.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(final.pointsCredited).toBe(245);
    expect(
      await prisma.ledgerJournal.count({
        where: { idempotencyKey: `topup-mismatch:${row.id}` },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { idempotencyKey: `admin-audit:topup-mismatch:${row.id}` },
      }),
    ).toBe(1);
  });

  it('serializes provider full-payment credit against mismatch credit', async () => {
    const row = await create();
    const snapshot = {
      orderCode: row.orderCode!,
      providerStatus: 'PAID',
      effect: 'CREDIT' as const,
      facts: {
        amountPaidVnd: 50_000,
        paidAt: new Date(),
        providerReference: 'PAYOS-FULL',
        counterAccountBankId: null,
        counterAccountBankName: null,
        counterAccountName: null,
        counterAccountNumber: null,
      },
    };
    const outcomes = await Promise.allSettled([
      service.resolveMismatch(
        row.id,
        { action: 'CREDIT', expectedAmountPaidVnd: 49_000 },
        { adminId },
      ),
      service.applySnapshot(row.id, snapshot),
    ]);
    expect(outcomes.some((result) => result.status === 'fulfilled')).toBe(true);
    const journals = await prisma.ledgerJournal.findMany({
      where: {
        idempotencyKey: {
          in: [`topup-credit:${row.id}`, `topup-mismatch:${row.id}`],
        },
      },
    });
    expect(journals).toHaveLength(1);
    const final = await prisma.topUpRequest.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(final.journalId).toBe(journals[0].id);
    expect(final.pointsCredited).toBe(
      journals[0].idempotencyKey.startsWith('topup-credit:') ? 250 : 245,
    );
    const available = await prisma.ledgerAccount.findFirstOrThrow({
      where: {
        userId: row.userId,
        accountClass: 'USER_AVAILABLE',
      },
    });
    expect(available.balance).toBe(final.pointsCredited);
  });

  it('refund blocks later provider credit', async () => {
    const row = await create();
    await service.resolveMismatch(
      row.id,
      {
        action: 'MANUAL_REFUND',
        expectedAmountPaidVnd: 49_000,
        note: 'Refund receipt',
      },
      { adminId },
    );
    await service.applySnapshot(row.id, {
      orderCode: row.orderCode!,
      providerStatus: 'PAID',
      effect: 'CREDIT',
      facts: {
        amountPaidVnd: 50_000,
        paidAt: new Date(),
        providerReference: 'PAYOS-REFUND',
        counterAccountBankId: null,
        counterAccountBankName: null,
        counterAccountName: null,
        counterAccountNumber: null,
      },
    });
    expect(
      (await prisma.topUpRequest.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe('MANUAL_REFUNDED');
    expect(
      await prisma.ledgerJournal.count({
        where: {
          idempotencyKey: {
            in: [`topup-mismatch:${row.id}`, `topup-credit:${row.id}`],
          },
        },
      }),
    ).toBe(0);
  });
});
