import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  databaseUrl,
  probeDatabase,
  requireDb,
} from './fixtures/financial-pg-harness';

const available = probeDatabase();
if (!available && requireDb)
  throw new Error('Financial PostgreSQL test database unavailable');

(available ? describe : describe.skip)(
  'PayOS top-up database constraints (13.1)',
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const users: string[] = [];
    const expiresAt = new Date('2030-01-01T00:00:00Z');

    async function user(): Promise<string> {
      const created = await prisma.user.create({
        data: { email: `payos-${randomUUID()}@example.com` },
      });
      users.push(created.id);
      return created.id;
    }

    async function payos(
      userId: string,
      amountVnd = 10000,
      status: 'PROCESSING' | 'CANCELLED' = 'PROCESSING',
      orderCode?: number,
    ) {
      const [code] = await prisma.$queryRaw<
        Array<{ value: number }>
      >`SELECT nextval('top_up_order_code_seq')::int AS value`;
      return prisma.topUpRequest.create({
        data: {
          userId,
          channel: 'PAYOS',
          amount: amountVnd / 200,
          amountVnd,
          orderCode: orderCode ?? code.value,
          expiresAt,
          status,
        },
      });
    }

    beforeAll(async () => {
      await prisma.$connect();
    });
    afterAll(async () => {
      await prisma.topUpRequest.deleteMany({
        where: { userId: { in: users } },
      });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    it('rejects second PROCESSING row for same user but permits different users and CANCELLED rows', async () => {
      const first = await user();
      const second = await user();
      await payos(first);
      await expect(payos(first)).rejects.toMatchObject({ code: 'P2002' });
      await expect(payos(second)).resolves.toBeDefined();
      await expect(payos(first, 10000, 'CANCELLED')).resolves.toBeDefined();
    });

    it('enforces PAYOS amount bounds and 200-VND increments', async () => {
      const id = await user();
      for (const amount of [9800, 5000200, 10100]) {
        await expect(payos(id, amount, 'CANCELLED')).rejects.toThrow(/23514/);
      }
      await expect(payos(id, 10000, 'CANCELLED')).resolves.toBeDefined();
      await expect(payos(id, 5000000, 'CANCELLED')).resolves.toBeDefined();
    });

    it('ties status to channel and PAYOS points to amountVnd', async () => {
      const id = await user();
      const [code] = await prisma.$queryRaw<
        Array<{ value: number }>
      >`SELECT nextval('top_up_order_code_seq')::int AS value`;
      await expect(
        prisma.topUpRequest.create({
          data: {
            userId: id,
            channel: 'PAYOS',
            amount: 50,
            amountVnd: 10000,
            orderCode: code.value,
            expiresAt,
          },
        }),
      ).rejects.toThrow(/23514/);
      await expect(
        prisma.topUpRequest.create({
          data: {
            userId: id,
            amount: 50,
            amountVnd: 10000,
            transferReference: `RESCOM${randomUUID()}`,
            status: 'PROCESSING',
          },
        }),
      ).rejects.toThrow(/23514/);
      await expect(
        prisma.topUpRequest.create({
          data: {
            userId: id,
            channel: 'PAYOS',
            amount: 51,
            amountVnd: 10000,
            orderCode: code.value,
            expiresAt,
            status: 'CANCELLED',
          },
        }),
      ).rejects.toThrow(/23514/);
    });

    it('enforces channel shape and defaults manual channel', async () => {
      const id = await user();
      await expect(
        prisma.topUpRequest.create({
          data: {
            userId: id,
            channel: 'PAYOS',
            amount: 50,
            amountVnd: 10000,
            expiresAt,
          },
        }),
      ).rejects.toThrow(/23514/);
      await expect(
        prisma.topUpRequest.create({
          data: {
            userId: id,
            amount: 50,
            amountVnd: 10000,
          },
        }),
      ).rejects.toThrow(/23514/);
      const manual = await prisma.topUpRequest.create({
        data: {
          userId: id,
          amount: 50,
          amountVnd: 10000,
          transferReference: `RESCOM${randomUUID()}`,
        },
      });
      expect(manual.channel).toBe('MANUAL');
      const codes = await prisma.$queryRaw<Array<{ value: number }>>`
      SELECT nextval('top_up_order_code_seq')::int AS value
      UNION ALL SELECT nextval('top_up_order_code_seq')::int`;
      expect(codes[0].value).toBeGreaterThanOrEqual(1000000000);
      expect(codes[0].value).not.toBe(codes[1].value);
    });
  },
);
