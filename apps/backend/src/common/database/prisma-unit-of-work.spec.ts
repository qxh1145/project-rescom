import {
  PrismaUnitOfWork,
  currentClient,
  isInAmbientTransaction,
  runInTransaction,
} from './prisma-unit-of-work';

function createFakePrisma() {
  const tx = { id: 'tx-1' };
  const prisma = {
    $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) =>
      work(tx),
    ),
  };
  return { prisma, tx };
}

describe('PrismaUnitOfWork', () => {
  it('opens one interactive transaction when none is active', async () => {
    const { prisma, tx } = createFakePrisma();

    const client = await runInTransaction(prisma as any, async (c) => c);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(client).toBe(tx);
  });

  it('lets repositories join the ambient Unit of Work instead of opening nested transactions', async () => {
    const { prisma, tx } = createFakePrisma();
    const unitOfWork = new PrismaUnitOfWork(prisma as any);
    const seen: unknown[] = [];

    await unitOfWork.run('external-completion:attempt-1', async () => {
      seen.push(await runInTransaction(prisma as any, async (c) => c));
      seen.push(await runInTransaction(prisma as any, async (c) => c));
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([tx, tx]);
  });

  it('propagates failures so the whole Unit of Work rolls back', async () => {
    const { prisma } = createFakePrisma();
    const unitOfWork = new PrismaUnitOfWork(prisma as any);

    await expect(
      unitOfWork.run('external-completion:attempt-1', async () => {
        await runInTransaction(prisma as any, async () => undefined);
        throw new Error('ledger failure');
      }),
    ).rejects.toThrow('ledger failure');
  });

  it('routes reads through the ambient transaction only while a Unit of Work is open (Epic 6 review P7/P14)', async () => {
    const { prisma, tx } = createFakePrisma();
    const unitOfWork = new PrismaUnitOfWork(prisma as any);

    expect(currentClient(prisma as any)).toBe(prisma);
    expect(isInAmbientTransaction()).toBe(false);

    const inside = await unitOfWork.run('k', async () => ({
      client: currentClient(prisma as any),
      ambient: isInAmbientTransaction(),
    }));

    expect(inside).toEqual({ client: tx, ambient: true });
    expect(currentClient(prisma as any)).toBe(prisma);
    expect(isInAmbientTransaction()).toBe(false);
  });

  it('does not leak the ambient transaction after the Unit of Work ends', async () => {
    const { prisma } = createFakePrisma();
    const unitOfWork = new PrismaUnitOfWork(prisma as any);

    await unitOfWork.run('k', async () => undefined);
    await runInTransaction(prisma as any, async () => undefined);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
