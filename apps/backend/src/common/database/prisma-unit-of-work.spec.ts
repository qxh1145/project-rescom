import { Logger } from '@nestjs/common';
import {
  PrismaUnitOfWork,
  afterCommit,
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

  describe('afterCommit (Story IR.2b Task 2.3)', () => {
    it('runs the callback at once outside a Unit of Work', async () => {
      const calls: string[] = [];
      await afterCommit(() => {
        calls.push('ran');
      });
      expect(calls).toEqual(['ran']);
    });

    it('defers callbacks until the outermost transaction committed, outside the ambient context', async () => {
      const { prisma } = createFakePrisma();
      const unitOfWork = new PrismaUnitOfWork(prisma as any);
      const events: string[] = [];

      await unitOfWork.run('k', async () => {
        await runInTransaction(prisma as any, async () => {
          await afterCommit(() => {
            events.push(`callback ambient=${isInAmbientTransaction()}`);
          });
        });
        events.push('work done');
      });

      expect(events).toEqual(['work done', 'callback ambient=false']);
    });

    it('drops the queue when the transaction rolls back', async () => {
      const { prisma } = createFakePrisma();
      const unitOfWork = new PrismaUnitOfWork(prisma as any);
      const callback = jest.fn();

      await expect(
        unitOfWork.run('k', async () => {
          await afterCommit(callback);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');

      expect(callback).not.toHaveBeenCalled();
    });

    it('a failing callback never rejects the committed work and is logged with its context (review LOW-12)', async () => {
      const { prisma } = createFakePrisma();
      const second = jest.fn();
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        runInTransaction(prisma as any, async () => {
          await afterCommit(() => {
            throw new Error('publish failed');
          }, 'notification dedupeKey=internal-reward:r-1');
          await afterCommit(second);
          return 'committed';
        }),
      ).resolves.toBe('committed');
      expect(second).toHaveBeenCalledTimes(1);
      const line = errorSpy.mock.calls[0][0] as string;
      expect(line).toMatch(/^AFTER_COMMIT_FAILED /);
      expect(JSON.parse(line.slice('AFTER_COMMIT_FAILED '.length))).toEqual({
        context: 'notification dedupeKey=internal-reward:r-1',
        txId: expect.any(String),
        error: 'Error',
      });
      errorSpy.mockRestore();
    });

    it('a callback that opens a transaction gets a fresh one', async () => {
      const { prisma } = createFakePrisma();

      await runInTransaction(prisma as any, async () => {
        await afterCommit(async () => {
          await runInTransaction(prisma as any, async () => undefined);
        });
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });
});
