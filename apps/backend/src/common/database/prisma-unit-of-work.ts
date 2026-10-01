import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UnitOfWorkPort } from './unit-of-work.port';

/** Prisma interactive-transaction limits (defaults: maxWait 2 s, timeout 5 s). */
export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
}

type TransactionCapableClient = {
  $transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
};

/** A callback queued with `afterCommit`; it must not throw (it is caught). */
export type AfterCommitCallback = () => Promise<void> | void;

interface QueuedCallback {
  callback: AfterCommitCallback;
  /** What a lost callback was (logged on failure), e.g. a dedupe key. */
  context: string | null;
}

interface AmbientTransaction {
  tx: Prisma.TransactionClient;
  /** Story IR.2b Task 2.3: run once the outermost transaction committed. */
  afterCommit: QueuedCallback[];
  /** Correlation id of the outermost transaction (review LOW-12). */
  txId: string;
}

const ambientTransaction = new AsyncLocalStorage<AmbientTransaction>();
const logger = new Logger('UnitOfWork');

/**
 * Runs `work` inside the ambient Unit of Work transaction when one is open,
 * otherwise opens a new interactive transaction. Repositories that must join
 * a shared Unit of Work (AD-16) use this instead of calling `$transaction`
 * directly, so their writes commit or roll back together with the caller.
 *
 * The outermost call runs the callbacks queued with `afterCommit` once its
 * transaction committed (never after a rollback), outside the finished
 * ambient context, so a callback that opens a transaction gets a fresh one.
 */
export async function runInTransaction<T>(
  prisma: TransactionCapableClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  const ambient = ambientTransaction.getStore();
  if (ambient) {
    return work(ambient.tx);
  }
  const queue: QueuedCallback[] = [];
  const txId = randomUUID();
  const result = await prisma.$transaction(
    (tx) =>
      ambientTransaction.run({ tx, afterCommit: queue, txId }, () => work(tx)),
    options,
  );
  await ambientTransaction.exit(() => runAfterCommit(queue, txId));
  return result;
}

async function runAfterCommit(
  queue: QueuedCallback[],
  txId: string | null,
): Promise<void> {
  // Callbacks queued by other callbacks (none today) are not re-run here:
  // each callback runs outside any ambient transaction.
  for (const { callback, context } of queue.splice(0)) {
    try {
      await callback();
    } catch (error) {
      // Review LOW-12: enough to find and replay the lost effect by hand.
      logger.error(
        `AFTER_COMMIT_FAILED ${JSON.stringify({
          context,
          txId,
          error: error instanceof Error ? error.name : 'UnknownError',
        })}`,
      );
    }
  }
}

/**
 * Story IR.2b Task 2.3: inside an ambient Unit of Work, queues `callback` to
 * run after the outermost transaction commits (dropped on rollback); outside
 * one, runs it at once. Never rejects: a failing callback is logged.
 */
export async function afterCommit(
  callback: AfterCommitCallback,
  context: string | null = null,
): Promise<void> {
  const ambient = ambientTransaction.getStore();
  if (ambient) {
    ambient.afterCommit.push({ callback, context });
    return;
  }
  await runAfterCommit([{ callback, context }], null);
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
  return ambientTransaction.getStore()?.tx ?? prisma;
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
  constructor(
    private readonly prisma: TransactionCapableClient,
    /** Explicit limits (the Outbox dispatcher's short handler transactions). */
    private readonly options?: TransactionOptions,
  ) {}

  run<T>(_key: string, work: () => Promise<T>): Promise<T> {
    return runInTransaction(this.prisma, () => work(), this.options);
  }
}
