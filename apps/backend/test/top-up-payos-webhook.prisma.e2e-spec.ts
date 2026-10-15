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
import { PrismaPayosTopUpRepository } from '../src/modules/economy/infrastructure/prisma-payos-top-up.repository';
import { PrismaLedgerRepository } from '../src/modules/economy/infrastructure/prisma-ledger.repository';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { PayosTopUpService } from '../src/modules/economy/application/payos-top-up.service';
import { PrismaUnitOfWork } from '../src/common/database/prisma-unit-of-work';
import { FakePaymentProvider } from '../src/modules/economy/infrastructure/fake-payment-provider';
import {
  buildPaymentLink,
  buildPayosWebhookData,
  signPayosWebhook,
  PAYOS_TEST_CHECKSUM_KEY,
} from './fixtures/payos-webhook.fixture';

const available = probeDatabase();
if (!available && requireDb)
  throw new Error('Financial PostgreSQL test database unavailable');
(available ? describe : describe.skip)(
  'PayOS webhook concurrent credit (DB)',
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const db = prisma as PrismaService;
    const repository = new PrismaPayosTopUpRepository(db);
    const ledger = new LedgerService(new PrismaLedgerRepository(db));
    const provider = new FakePaymentProvider(PAYOS_TEST_CHECKSUM_KEY);
    const service = new PayosTopUpService({
      repository,
      ledgerService: ledger,
      unitOfWork: new PrismaUnitOfWork(db),
      provider,
      appBaseUrl: 'http://localhost',
      limit: 5,
      windowSeconds: 600,
      logger: { log: jest.fn(), warn: jest.fn() },
    });
    const users: string[] = [];
    async function create(status: 'PROCESSING' | 'CANCELLED' = 'PROCESSING') {
      const user = await prisma.user.create({
        data: { email: `credit-${randomUUID()}@example.com` },
      });
      users.push(user.id);
      const [code] = await prisma.$queryRaw<
        Array<{ code: number }>
      >`SELECT nextval('top_up_order_code_seq')::int AS code`;
      const row = await prisma.topUpRequest.create({
        data: {
          userId: user.id,
          amount: 100,
          amountVnd: 20000,
          channel: 'PAYOS',
          orderCode: code.code,
          status,
          expiresAt: new Date(Date.now() + 300000),
        },
      });
      provider.setPayment(
        row.orderCode!,
        buildPaymentLink({
          orderCode: row.orderCode,
          id: String(row.orderCode),
        }),
      );
      const body = signPayosWebhook(
        buildPayosWebhookData({
          orderCode: row.orderCode,
          paymentLinkId: String(row.orderCode),
        }),
      );
      const snapshot = await provider.getPayment(row.orderCode!, row.amountVnd);
      return { row, body, snapshot };
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
      await prisma.topUpRequest.deleteMany({
        where: { userId: { in: users } },
      });
      // Posted ledger rows are immutable; retain users owning posted journals.
      await prisma.user.deleteMany({
        where: { id: { in: users }, ledgerAccounts: { none: {} } },
      });
      await prisma.$disconnect();
    });
    it('serializes two verified webhooks and direct credit into one journal/event', async () => {
      const { row, body, snapshot } = await create();
      const results = await Promise.all([
        service.handleWebhook(body),
        service.handleWebhook(body),
        service.creditTopUp(row.id, snapshot),
      ]);
      expect(results.filter((r) => r.outcome === 'APPLIED')).toHaveLength(1);
      expect(
        await prisma.ledgerJournal.count({
          where: { idempotencyKey: `topup-credit:${row.id}` },
        }),
      ).toBe(1);
      expect(
        await prisma.outboxEvent.count({
          where: { idempotencyKey: `topup-credit:${row.id}` },
        }),
      ).toBe(1);
      expect(
        await prisma.topUpRequest.findUniqueOrThrow({ where: { id: row.id } }),
      ).toMatchObject({ status: 'SUCCESSFUL', pointsCredited: 100 });
      const account = await ledger.getOrCreateAccount(
        row.userId,
        'USER_AVAILABLE',
      );
      expect(account.balance).toBe(100);
      const journal = await prisma.ledgerJournal.findUniqueOrThrow({
        where: { idempotencyKey: `topup-credit:${row.id}` },
      });
      await expect(
        ledger.reverseJournal({ targetJournalId: journal.id }),
      ).rejects.toThrow('Top-up credit journals cannot be reversed');
    });
    it('credits late cancelled payment', async () => {
      const { row, body } = await create('CANCELLED');
      expect(await service.handleWebhook(body)).toEqual({ outcome: 'APPLIED' });
      expect(
        (await prisma.topUpRequest.findUniqueOrThrow({ where: { id: row.id } }))
          .status,
      ).toBe('SUCCESSFUL');
    });
    it('mismatch writes no credit journal', async () => {
      const { row, body } = await create();
      provider.setPayment(
        row.orderCode!,
        buildPaymentLink({
          orderCode: row.orderCode,
          id: String(row.orderCode),
          status: 'UNDERPAID',
          amountPaid: 10000,
        }),
      );
      expect(await service.handleWebhook(body)).toEqual({ outcome: 'APPLIED' });
      expect(
        (await prisma.topUpRequest.findUniqueOrThrow({ where: { id: row.id } }))
          .status,
      ).toBe('AMOUNT_MISMATCH');
      expect(
        await prisma.ledgerJournal.count({
          where: { idempotencyKey: `topup-credit:${row.id}` },
        }),
      ).toBe(0);
    });
    it('rolls back status and event if ledger journal conflicts', async () => {
      const { row, body } = await create();
      const clearing = await ledger.getOrCreateAccount(null, 'SYSTEM_CLEARING');
      const available = await ledger.getOrCreateAccount(
        row.userId,
        'USER_AVAILABLE',
      );
      await ledger.postJournal({
        idempotencyKey: `topup-credit:${row.id}`,
        description: 'conflict',
        entries: [
          { accountId: clearing.id, amount: -50 },
          { accountId: available.id, amount: 50 },
        ],
      });
      await expect(service.handleWebhook(body)).rejects.toThrow();
      expect(
        (await prisma.topUpRequest.findUniqueOrThrow({ where: { id: row.id } }))
          .status,
      ).toBe('PROCESSING');
      expect(
        await prisma.outboxEvent.count({
          where: { idempotencyKey: `topup-credit:${row.id}` },
        }),
      ).toBe(0);
    });
  },
);
