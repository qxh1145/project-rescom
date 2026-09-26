import { PrismaLedgerRepository } from './prisma-ledger.repository';
import { PrismaUnitOfWork } from '../../../common/database/prisma-unit-of-work';
import { LedgerAccountEntity } from '../domain/ledger-account.entity';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { LedgerEntryEntity } from '../domain/ledger-entry.entity';
import {
  ConcurrentLedgerCommandException,
  IdempotencyConflictException,
  InsufficientBalanceException,
} from '../application/exceptions/economy.exceptions';

/**
 * Epic 6 review P7/P14/P11: the Prisma ledger adapter against mocked clients.
 * PostgreSQL behaviour itself (row locks, rollback) stays covered by the
 * Postgres-gated suite (DF5).
 */
describe('PrismaLedgerRepository (Epic 6 review P7/P14)', () => {
  const accountRow = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    accountClass: 'USER_AVAILABLE',
    currency: 'POINTS',
    balance: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function fakeClient(label: string) {
    return {
      label,
      ledgerAccount: {
        findFirst: jest.fn().mockResolvedValue(accountRow),
        findUnique: jest.fn().mockResolvedValue(accountRow),
        findMany: jest.fn().mockResolvedValue([accountRow]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(accountRow),
      },
      ledgerJournal: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      ledgerEntry: {
        createMany: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn(),
    };
  }

  function setup() {
    const tx = fakeClient('tx');
    const prisma = {
      ...fakeClient('prisma'),
      $transaction: jest.fn(async (work: (client: unknown) => unknown) =>
        work(tx),
      ),
    };
    const repository = new PrismaLedgerRepository(prisma as any);
    const unitOfWork = new PrismaUnitOfWork(prisma as any);
    return { tx, prisma, repository, unitOfWork };
  }

  function journalWithEntries(key: string): {
    journal: LedgerJournalEntity;
    entries: LedgerEntryEntity[];
  } {
    const journal = LedgerJournalEntity.create({ idempotencyKey: key });
    const entries = [
      LedgerEntryEntity.create({
        journalId: journal.id,
        accountId: accountRow.id,
        amount: -5,
      }),
      LedgerEntryEntity.create({
        journalId: journal.id,
        accountId: '33333333-3333-4333-8333-333333333333',
        amount: 5,
      }),
    ];
    return { journal, entries };
  }

  it('reads through the root client outside a Unit of Work', async () => {
    const { tx, prisma, repository } = setup();

    await repository.findJournalByIdempotencyKey('k');
    await repository.findAccountByUserAndClass(
      accountRow.userId,
      'USER_AVAILABLE',
    );

    expect(prisma.ledgerJournal.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.ledgerAccount.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.ledgerJournal.findUnique).not.toHaveBeenCalled();
  });

  it('reads through the ambient transaction inside a Unit of Work (no second pooled connection)', async () => {
    const { tx, prisma, repository, unitOfWork } = setup();

    await unitOfWork.run('publish:v1', async () => {
      await repository.findJournalByIdempotencyKey('publish:v1');
      await repository.findAccountById(accountRow.id);
      await repository.findAccountsByUserId(accountRow.userId);
      await repository.findJournalsByIdempotencyKeys(['a', 'b']);
      await repository.findJournalsByIdempotencyKeyPrefix('close-refund:f:');
    });

    expect(tx.ledgerJournal.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.ledgerAccount.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.ledgerAccount.findMany).toHaveBeenCalledTimes(1);
    expect(tx.ledgerJournal.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.ledgerJournal.findUnique).not.toHaveBeenCalled();
    expect(prisma.ledgerAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.ledgerJournal.findMany).not.toHaveBeenCalled();
  });

  it('creates accounts with ON CONFLICT DO NOTHING and re-selects on the same client', async () => {
    const { tx, prisma, repository, unitOfWork } = setup();
    const account = LedgerAccountEntity.create({
      userId: accountRow.userId,
      accountClass: 'USER_AVAILABLE',
      currency: 'POINTS',
      balance: 0,
    });

    const created = await unitOfWork.run('k', () =>
      repository.createAccount(account),
    );

    expect(tx.ledgerAccount.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: account.id })],
      skipDuplicates: true,
    });
    expect(tx.ledgerAccount.findFirst).toHaveBeenCalledWith({
      where: {
        userId: accountRow.userId,
        accountClass: 'USER_AVAILABLE',
        currency: 'POINTS',
      },
    });
    expect(prisma.ledgerAccount.createMany).not.toHaveBeenCalled();
    expect(created.id).toBe(accountRow.id);
  });

  it('chunks large key lookups', async () => {
    const { prisma, repository } = setup();
    const keys = Array.from({ length: 2500 }, (_, i) => `k-${i}`);

    await repository.findJournalsByIdempotencyKeys(keys);

    expect(prisma.ledgerJournal.findMany).toHaveBeenCalledTimes(3);
  });

  describe('duplicate idempotency key (P2002)', () => {
    function lockAndFailInsert(tx: ReturnType<typeof fakeClient>) {
      tx.$queryRaw.mockImplementation(async () => [
        { ...accountRow, balance: 100 },
      ]);
      tx.ledgerJournal.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['idempotency_key'] },
        }),
      );
    }

    it('fails a concurrent duplicate inside a shared Unit of Work with a retryable 409 (no converge in an aborted transaction)', async () => {
      const { tx, repository, unitOfWork } = setup();
      lockAndFailInsert(tx);
      const { journal, entries } = journalWithEntries('publish:v1');

      await expect(
        unitOfWork.run('publish:v1', () =>
          repository.postJournalTransaction(journal, entries),
        ),
      ).rejects.toBeInstanceOf(ConcurrentLedgerCommandException);
    });

    it('keeps the converge-able idempotency conflict for a standalone posting', async () => {
      const { tx, repository } = setup();
      lockAndFailInsert(tx);
      const { journal, entries } = journalWithEntries('seed');

      await expect(
        repository.postJournalTransaction(journal, entries),
      ).rejects.toBeInstanceOf(IdempotencyConflictException);
    });
  });

  it('reports an overdraft without account ids or balances (P11)', async () => {
    const { tx, repository } = setup();
    tx.$queryRaw.mockImplementation(async () => [
      { ...accountRow, balance: 1 },
    ]);
    const { journal, entries } = journalWithEntries('spend');

    const error = await repository
      .postJournalTransaction(journal, entries)
      .catch((e) => e);

    expect(error).toBeInstanceOf(InsufficientBalanceException);
    expect(error.message).toBe('Insufficient balance for ledger posting.');
    expect(error.message).not.toContain(accountRow.id);
  });
});
