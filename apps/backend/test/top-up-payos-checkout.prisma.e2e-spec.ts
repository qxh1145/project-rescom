import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPayosTopUpRepository } from '../src/modules/economy/infrastructure/prisma-payos-top-up.repository';
import { PrismaService } from '../src/common/database/prisma.service';
import {
  databaseUrl,
  probeDatabase,
  requireDb,
} from './fixtures/financial-pg-harness';

const available = probeDatabase();
if (!available && requireDb)
  throw new Error('Financial PostgreSQL test database unavailable');
(available ? describe : describe.skip)('PayOS checkout repository (DB)', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const repository = new PrismaPayosTopUpRepository(prisma as PrismaService);
  const users: string[] = [];
  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `payos-${randomUUID()}@example.com` },
    });
    users.push(user.id);
    return user.id;
  }
  const makeInput = (userId: string, now: Date) => ({
    id: randomUUID(),
    userId,
    amountVnd: 10_000,
    points: 50,
    expiresAt: new Date(now.getTime() + 300_000),
    createdAt: now,
  });
  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({
      where: {
        eventType: 'ECONOMY_TOPUP_STATUS_CHANGED',
        aggregateId: {
          in: users.length
            ? (
                await prisma.topUpRequest.findMany({
                  where: { userId: { in: users } },
                  select: { id: true },
                })
              ).map((row) => row.id)
            : [],
        },
      },
    });
    await prisma.topUpRequest.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  it('serializes concurrent checkouts; counts failed attempts; commits cancellation with event', async () => {
    const userId = await createUser();
    const now = new Date();
    const opts = { now, limit: 1, windowMs: 600_000 };
    const [first, second] = await Promise.all([
      repository.createProcessing(makeInput(userId, now), opts),
      repository.createProcessing(makeInput(userId, now), opts),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual([
      'ALREADY_PROCESSING',
      'CREATED',
    ]);
    const row =
      first.outcome === 'CREATED'
        ? first.topUp
        : second.outcome === 'CREATED'
          ? second.topUp
          : null;
    expect(row).not.toBeNull();
    const id = row!.id;
    const event = {
      id: randomUUID(),
      idempotencyKey: `topup-cancel:${id}`,
      eventType: 'ECONOMY_TOPUP_STATUS_CHANGED',
      producer: 'economy-service',
      aggregateType: 'TopUpRequest',
      aggregateId: id,
      aggregateVersion: 2,
      payload: {
        schemaVersion: 1 as const,
        topUpId: id,
        userId,
        orderCode: row!.orderCode,
        amountVnd: 10_000,
        points: 50,
        status: 'CANCELLED' as const,
        occurredAt: now.toISOString(),
      },
    };
    expect((await repository.markCancelled(id, now, event)).changed).toBe(true);
    expect((await repository.markCancelled(id, now, event)).changed).toBe(
      false,
    );
    expect(
      await prisma.outboxEvent.count({
        where: { idempotencyKey: event.idempotencyKey },
      }),
    ).toBe(1);
    const rateUser = await createUser();
    const five = { now, limit: 5, windowMs: 600_000 };
    for (let index = 0; index < 5; index++) {
      const when = new Date(now.getTime() + index * 1000);
      const created = await repository.createProcessing(
        makeInput(rateUser, when),
        { ...five, now: when },
      );
      expect(created.outcome).toBe('CREATED');
      if (created.outcome === 'CREATED')
        await repository.markCancelled(created.topUp.id, when, null);
    }
    const sixth = await repository.createProcessing(
      makeInput(rateUser, new Date(now.getTime() + 5000)),
      { ...five, now: new Date(now.getTime() + 5000) },
    );
    expect(sixth).toMatchObject({
      outcome: 'RATE_LIMITED',
      retryAfterSeconds: 595,
    });
    expect(
      (await repository.createProcessing(makeInput(userId, now), opts)).outcome,
    ).toBe('RATE_LIMITED');
    expect(
      (
        await repository.createProcessing(
          makeInput(userId, new Date(now.getTime() + 600_001)),
          { ...opts, now: new Date(now.getTime() + 600_001) },
        )
      ).outcome,
    ).toBe('CREATED');
  });
  it('counts manual pending only', async () => {
    const userId = await createUser();
    const pending = await prisma.topUpRequest.create({
      data: {
        userId,
        amount: 50,
        amountVnd: 10_000,
        transferReference: `RESCOM${randomUUID()
          .replace(/[^A-HJ-NP-Z2-9]/g, 'A')
          .slice(0, 8)}`,
      },
    });
    expect(await repository.countManualPending()).toBeGreaterThanOrEqual(1);
    await prisma.topUpRequest.update({
      where: { id: pending.id },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        adminId: userId,
        rejectionReason: 'test',
      },
    });
  });
});
