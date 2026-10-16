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
import { TopUpAdminAlerts } from '../src/modules/economy/application/top-up-admin-alerts';
import { PayosReconcileJob } from '../src/modules/economy/infrastructure/jobs/payos-reconcile.job';
import { testJobContext } from '../src/common/scheduler/test-job-context';
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
  'PayOS reconciliation, alerts and concurrency race (DB)',
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const db = prisma as PrismaService;
    const repository = new PrismaPayosTopUpRepository(db);
    const ledger = new LedgerService(new PrismaLedgerRepository(db));
    const provider = new FakePaymentProvider(PAYOS_TEST_CHECKSUM_KEY);
    const alerts = new TopUpAdminAlerts(repository);
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
    const job = new PayosReconcileJob(service, repository, provider, alerts);

    const users: string[] = [];
    async function create(
      status: 'PROCESSING' | 'CANCELLED' | 'AMOUNT_MISMATCH' = 'PROCESSING',
      options?: {
        amount?: number;
        amountVnd?: number;
        expiresAt?: Date;
        amountPaidVnd?: number;
        paidAt?: Date;
      },
    ) {
      const user = await prisma.user.create({
        data: { email: `reconcile-${randomUUID()}@example.com` },
      });
      users.push(user.id);
      const [code] = await prisma.$queryRaw<
        Array<{ code: number }>
      >`SELECT nextval('top_up_order_code_seq')::int AS code`;

      const amountVnd = options?.amountVnd ?? 20000;
      const amount = options?.amount ?? amountVnd / 200;

      const row = await prisma.topUpRequest.create({
        data: {
          userId: user.id,
          amount,
          amountVnd,
          channel: 'PAYOS',
          orderCode: code.code,
          status,
          expiresAt: options?.expiresAt ?? new Date(Date.now() + 300000),
          amountPaidVnd: options?.amountPaidVnd ?? null,
          paidAt: options?.paidAt ?? null,
        },
      });

      provider.setPayment(
        row.orderCode!,
        buildPaymentLink({
          orderCode: row.orderCode,
          id: String(row.orderCode),
          amount: row.amountVnd,
          amountPaid: row.amountVnd,
          amountRemaining: 0,
          status: 'PAID',
        }),
      );

      const body = signPayosWebhook(
        buildPayosWebhookData({
          orderCode: row.orderCode,
          paymentLinkId: String(row.orderCode),
          amount: row.amountVnd,
        }),
      );
      return { row, body };
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

    it('serializes reconcile job, webhook, and admin recheck on a PAID row with exactly one ledger credit', async () => {
      const { row, body } = await create('PROCESSING');
      const adminId = randomUUID();
      const ctx = testJobContext();

      const [, , recheckRes] = await Promise.all([
        job.run(ctx),
        service.handleWebhook(body),
        service.recheck({
          topUpId: row.id,
          adminId,
          correlationId: randomUUID(),
        }),
      ]);

      // Exactly one ledger journal created
      expect(
        await prisma.ledgerJournal.count({
          where: { idempotencyKey: `topup-credit:${row.id}` },
        }),
      ).toBe(1);

      // Exactly one credit Outbox event
      expect(
        await prisma.outboxEvent.count({
          where: { idempotencyKey: `topup-credit:${row.id}` },
        }),
      ).toBe(1);

      // TopUp row ends in SUCCESSFUL with correct points
      const updated = await prisma.topUpRequest.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(updated.status).toBe('SUCCESSFUL');
      expect(updated.pointsCredited).toBe(100);

      // Recheck result should be CREDITED
      expect(recheckRes.result).toBe('CREDITED');
    });

    it('deduplicates admin alert by idempotency key with skipDuplicates: true', async () => {
      const { row } = await create('PROCESSING');
      const first = await alerts.raise('UNCREDITED_AFTER_PAYMENT', row.id, {
        topUpId: row.id,
        orderCode: row.orderCode!,
        amountVnd: row.amountVnd,
      });
      expect(first).toBe(true);

      const second = await alerts.raise('UNCREDITED_AFTER_PAYMENT', row.id, {
        topUpId: row.id,
        orderCode: row.orderCode!,
        amountVnd: row.amountVnd,
      });
      expect(second).toBe(false);

      const alertEvents = await prisma.outboxEvent.findMany({
        where: {
          idempotencyKey: `topup-alert:UNCREDITED_AFTER_PAYMENT:${row.id}`,
        },
      });
      expect(alertEvents.length).toBe(1);
    });

    it('markExpired CAS loses to a concurrent credit and row ends SUCCESSFUL', async () => {
      const { row, body } = await create('PROCESSING');

      // Credit the row
      await service.handleWebhook(body);

      // Attempt to expire it now that it is SUCCESSFUL
      const expiredResult = await repository.markExpired(row.id, new Date(), {
        id: randomUUID(),
        idempotencyKey: `topup-expire:${row.id}`,
        eventType: 'ECONOMY_TOPUP_STATUS_CHANGED',
        producer: 'economy-service',
        aggregateType: 'TopUpRequest',
        aggregateId: row.id,
        aggregateVersion: 2,
        payload: {
          schemaVersion: 1,
          topUpId: row.id,
          userId: row.userId,
          orderCode: row.orderCode!,
          amountVnd: row.amountVnd,
          points: 100,
          status: 'EXPIRED',
          occurredAt: new Date().toISOString(),
        },
      });

      expect(expiredResult.changed).toBe(false);

      const finalRow = await prisma.topUpRequest.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(finalRow.status).toBe('SUCCESSFUL');
    });

    it('mismatch refresh updates amountPaidVnd and preserves initial paidAt SLA anchor', async () => {
      const initialPaidAt = new Date('2026-10-10T10:00:00.000Z');
      const { row } = await create('AMOUNT_MISMATCH', {
        amountVnd: 50000,
        amountPaidVnd: 20000,
        paidAt: initialPaidAt,
      });

      // Mismatch refresh with new cumulative amount
      const refreshSnapshot = {
        orderCode: row.orderCode!,
        providerStatus: 'UNDERPAID',
        effect: 'AMOUNT_MISMATCH' as const,
        facts: {
          orderCode: row.orderCode!,
          paymentLinkId: String(row.orderCode),
          amountPaidVnd: 35000,
          amountRemainingVnd: 15000,
          paidAt: new Date('2026-10-12T12:00:00.000Z'),
          providerReference: 'PAYOS-REFRESH-1',
          counterAccountBankId: '970436',
          counterAccountBankName: 'Vietcombank',
          counterAccountName: 'BUYER',
          counterAccountNumber: '999888',
        },
      };

      const result = await service.applySnapshot(row.id, refreshSnapshot);
      expect(result.outcome).toBe('APPLIED');

      const updated = await prisma.topUpRequest.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(updated.amountPaidVnd).toBe(35000);
      // SLA anchor paidAt must be preserved
      expect(updated.paidAt?.toISOString()).toBe(initialPaidAt.toISOString());
    });
  },
);
