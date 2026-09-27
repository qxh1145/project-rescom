import { AsyncLocalStorage } from 'async_hooks';
import { Prisma } from '@prisma/client';
import { UnitOfWorkPort } from './unit-of-work.port';

type TransactionCapableClient = {
  $transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
};

const ambientTransaction = new AsyncLocalStorage<Prisma.TransactionClient>();

/**
 * Runs `work` inside the ambient Unit of Work transaction when one is open,
 * otherwise opens a new interactive transaction. Repositories that must join
 * a shared Unit of Work (AD-16) use this instead of calling `$transaction`
 * directly, so their writes commit or roll back together with the caller.
 */
export function runInTransaction<T>(
  prisma: TransactionCapableClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const ambient = ambientTransaction.getStore();
  if (ambient) {
    return work(ambient);
  }
  return prisma.$transaction((tx) =>
    ambientTransaction.run(tx, () => work(tx)),
  );
}

/**
 * The client a repository read must use: the ambient Unit of Work transaction
 * when one is open, otherwise `prisma`. Reads made inside a Unit of Work then
 * see the Unit of Work's own writes and do not wait for a second pooled
 * connection while the transaction holds one (Epic 6 review P7).
 */
export function currentClient(
  prisma: Prisma.TransactionClient,
): Prisma.TransactionClient {
  return ambientTransaction.getStore() ?? prisma;
}

/**
 * True when the caller already runs inside a shared Unit of Work. A unique
 * violation there aborts the whole PostgreSQL transaction, so repositories
 * must not "converge" on the winning row inside it (Epic 6 review P14).
 */
export function isInAmbientTransaction(): boolean {
  return ambientTransaction.getStore() !== undefined;
}

export class PrismaUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly prisma: TransactionCapableClient) {}

  run<T>(_key: string, work: () => Promise<T>): Promise<T> {
    return runInTransaction(this.prisma, () => work());
  }
}
