import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canAccountClassOverdraft, LedgerAccountClass } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  LedgerRepositoryPort,
  UserLedgerTransactionRecord,
} from '../application/ports/ledger-repository.port';
import { LedgerAccountEntity } from '../domain/ledger-account.entity';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { LedgerEntryEntity } from '../domain/ledger-entry.entity';
import {
  AccountNotFoundException,
  ConcurrentLedgerCommandException,
  IdempotencyConflictException,
  InsufficientBalanceException,
  InvalidLedgerOperationException,
  JournalAlreadyReversedException,
  UnbalancedJournalException,
} from '../application/exceptions/economy.exceptions';
import {
  currentClient,
  isInAmbientTransaction,
  runInTransaction,
} from '../../../common/database/prisma-unit-of-work';

/** Keys per `IN (...)` lookup, so a large form never builds one huge query. */
const KEY_LOOKUP_CHUNK_SIZE = 1000;

@Injectable()
export class PrismaLedgerRepository implements LedgerRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads join the ambient Unit of Work when one is open (Epic 6 review P7):
   * they see its own writes and never wait for a second pooled connection.
   */
  private get client(): Prisma.TransactionClient {
    return currentClient(this.prisma);
  }

  async findAccountById(id: string): Promise<LedgerAccountEntity | null> {
    const raw = await this.client.ledgerAccount.findUnique({
      where: { id },
    });
    return raw ? this.toAccountEntity(raw) : null;
  }

  async findAccountByUserAndClass(
    userId: string | null,
    accountClass: LedgerAccountClass,
    currency = 'POINTS',
  ): Promise<LedgerAccountEntity | null> {
    const raw = await this.client.ledgerAccount.findFirst({
      where: {
        userId,
        accountClass,
        currency,
      },
    });
    return raw ? this.toAccountEntity(raw) : null;
  }

  async findAccountsByUserId(userId: string): Promise<LedgerAccountEntity[]> {
    const list = await this.client.ledgerAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return list.map((a) => this.toAccountEntity(a));
  }

  async createAccount(
    account: LedgerAccountEntity,
  ): Promise<LedgerAccountEntity> {
    // INSERT ... ON CONFLICT DO NOTHING (unique owner/class/currency, NULLS NOT
    // DISTINCT): a concurrent creator never raises P2002, which would abort
    // the caller's Unit of Work (Epic 6 review P7). The re-select runs on the
    // same client, so an account created inside a Unit of Work rolls back
    // with it.
    const client = this.client;
    await client.ledgerAccount.createMany({
      data: [
        {
          id: account.id,
          userId: account.userId,
          accountClass: account.accountClass,
          currency: account.currency,
          balance: account.balance,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        },
      ],
      skipDuplicates: true,
    });

    const stored = await client.ledgerAccount.findFirst({
      where: {
        userId: account.userId,
        accountClass: account.accountClass,
        currency: account.currency,
      },
    });
    if (!stored) {
      throw new AccountNotFoundException(
        'Ledger account could not be created or found.',
      );
    }
    return this.toAccountEntity(stored);
  }

  async findJournalById(id: string): Promise<LedgerJournalEntity | null> {
    const raw = await this.client.ledgerJournal.findUnique({
      where: { id },
      include: { entries: true },
    });
    return raw ? this.toJournalEntity(raw) : null;
  }

  async findJournalByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<LedgerJournalEntity | null> {
    const raw = await this.client.ledgerJournal.findUnique({
      where: { idempotencyKey },
      include: { entries: true },
    });
    return raw ? this.toJournalEntity(raw) : null;
  }

  async findReversalJournal(
    targetJournalId: string,
  ): Promise<LedgerJournalEntity | null> {
    const raw = await this.client.ledgerJournal.findUnique({
      where: { reversesJournalId: targetJournalId },
      include: { entries: true },
    });
    return raw ? this.toJournalEntity(raw) : null;
  }

  async findJournalsByIdempotencyKeys(
    idempotencyKeys: string[],
  ): Promise<LedgerJournalEntity[]> {
    const keys = Array.from(new Set(idempotencyKeys));
    const journals: LedgerJournalEntity[] = [];
    for (let i = 0; i < keys.length; i += KEY_LOOKUP_CHUNK_SIZE) {
      const rows = await this.client.ledgerJournal.findMany({
        where: {
          idempotencyKey: { in: keys.slice(i, i + KEY_LOOKUP_CHUNK_SIZE) },
        },
        include: { entries: true },
      });
      journals.push(...rows.map((row) => this.toJournalEntity(row)));
    }
    return journals;
  }

  async findJournalsByIdempotencyKeyPrefix(
    prefix: string,
  ): Promise<LedgerJournalEntity[]> {
    const rows = await this.client.ledgerJournal.findMany({
      where: { idempotencyKey: { startsWith: prefix } },
      include: { entries: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toJournalEntity(row));
  }

  async findReversalJournalsFor(
    targetJournalIds: string[],
  ): Promise<LedgerJournalEntity[]> {
    const ids = Array.from(new Set(targetJournalIds));
    const journals: LedgerJournalEntity[] = [];
    for (let i = 0; i < ids.length; i += KEY_LOOKUP_CHUNK_SIZE) {
      const rows = await this.client.ledgerJournal.findMany({
        where: {
          reversesJournalId: { in: ids.slice(i, i + KEY_LOOKUP_CHUNK_SIZE) },
        },
        include: { entries: true },
      });
      journals.push(...rows.map((row) => this.toJournalEntity(row)));
    }
    return journals;
  }

  async findMaturedPendingCredits(params: {
    cutoff: Date;
    limit: number;
  }): Promise<LedgerJournalEntity[]> {
    // External completion credits old enough to mature that were neither
    // released (`release-pending:{attemptId}`) nor reversed, oldest first.
    const rows: Array<{ id: string }> = await this.client.$queryRaw`
      SELECT j.id
      FROM ledger_journals j
      WHERE j.idempotency_key LIKE 'external-completion:%'
        AND j.created_at <= ${params.cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM ledger_journals r
          -- 21 = length('external-completion:') + 1: the attempt id suffix.
          WHERE r.idempotency_key = 'release-pending:' || substr(j.idempotency_key, 21)
        )
        AND NOT EXISTS (
          SELECT 1 FROM ledger_journals v WHERE v.reverses_journal_id = j.id
        )
      ORDER BY j.created_at ASC, j.id ASC
      LIMIT ${params.limit}
    `;
    if (rows.length === 0) {
      return [];
    }

    const journals = await this.client.ledgerJournal.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      include: { entries: true },
    });
    const byId = new Map(journals.map((row) => [row.id, row]));
    return rows
      .map((row) => byId.get(row.id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((row) => this.toJournalEntity(row));
  }

  async postJournalTransaction(
    journal: LedgerJournalEntity,
    entries: LedgerEntryEntity[],
  ): Promise<LedgerJournalEntity> {
    const sum = entries.reduce((total, entry) => total + entry.amount, 0);
    if (entries.length < 2 || sum !== 0) {
      throw new UnbalancedJournalException(
        `Journal ${journal.id} must have at least 2 entries and balance to zero. Current sum: ${sum}`,
      );
    }

    // A unique violation inside the caller's Unit of Work aborts the whole
    // PostgreSQL transaction, so it cannot converge on the winner there.
    const joinsCallerTransaction = isInAmbientTransaction();

    // Joins the caller's shared Unit of Work when one is open (AD-16).
    return runInTransaction(
      this.prisma,
      async (tx: Prisma.TransactionClient) => {
        // 1. Sort distinct account IDs in ascending order for deterministic deadlock-free locking
        const distinctAccountIds = Array.from(
          new Set(entries.map((e) => e.accountId)),
        ).sort();

        // 2. Lock accounts in ascending order using row-level locking
        const lockedAccounts: Array<{
          id: string;
          userId: string | null;
          accountClass: LedgerAccountClass;
          currency: string;
          balance: number;
        }> = [];

        for (const accountId of distinctAccountIds) {
          const rows: any[] = await tx.$queryRaw`
          SELECT id, user_id as "userId", account_class as "accountClass", currency, balance
          FROM ledger_accounts
          WHERE id = ${accountId}::uuid
          FOR UPDATE
        `;

          if (!rows || rows.length === 0) {
            throw new AccountNotFoundException(
              `Ledger account ${accountId} does not exist.`,
            );
          }

          lockedAccounts.push(rows[0]);
        }

        if (
          new Set(lockedAccounts.map((account) => account.currency)).size !== 1
        ) {
          throw new InvalidLedgerOperationException(
            'A ledger journal cannot mix account currencies.',
          );
        }

        // 3. Compute net deltas per account
        const deltas = new Map<string, number>();
        for (const entry of entries) {
          deltas.set(
            entry.accountId,
            (deltas.get(entry.accountId) || 0) + entry.amount,
          );
        }

        // 4. Enforce overdraft sufficiency for each locked account
        for (const row of lockedAccounts) {
          const delta = deltas.get(row.id) || 0;
          const canOverdraft = canAccountClassOverdraft(row.accountClass);
          if (!canOverdraft && row.balance + delta < 0) {
            // Generic on purpose (Epic 6 review P11): the message reaches API
            // callers, so it carries no account ids or balances.
            throw new InsufficientBalanceException(
              'Insufficient balance for ledger posting.',
            );
          }
        }

        // 5. Insert journal
        try {
          await tx.ledgerJournal.create({
            data: {
              id: journal.id,
              idempotencyKey: journal.idempotencyKey,
              description: journal.description,
              reversesJournalId: journal.reversesJournalId,
              createdAt: journal.createdAt,
            },
          });
        } catch (err: any) {
          if (err.code === 'P2002') {
            if (joinsCallerTransaction) {
              throw new ConcurrentLedgerCommandException(
                journal.idempotencyKey,
              );
            }
            if (err.meta?.target?.includes('reverses_journal_id')) {
              throw new JournalAlreadyReversedException(
                `Journal ${journal.reversesJournalId} has already been reversed.`,
              );
            }
            throw new IdempotencyConflictException(
              `Journal with key "${journal.idempotencyKey}" already exists.`,
            );
          }
          throw err;
        }

        // 6. Insert entries
        await tx.ledgerEntry.createMany({
          data: entries.map((e) => ({
            id: e.id,
            journalId: journal.id,
            accountId: e.accountId,
            amount: e.amount,
            createdAt: e.createdAt,
          })),
        });

        // 7. Update denormalized balance projections
        for (const [accountId, delta] of deltas.entries()) {
          await tx.ledgerAccount.update({
            where: { id: accountId },
            data: {
              balance: {
                increment: delta,
              },
            },
          });
        }

        const createdJournal = await tx.ledgerJournal.findUniqueOrThrow({
          where: { id: journal.id },
          include: { entries: true },
        });

        return this.toJournalEntity(createdJournal);
      },
    );
  }

  async sumEntriesByAccountId(accountId: string): Promise<number> {
    const result = await this.client.ledgerEntry.aggregate({
      where: { accountId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async sumAllEntries(): Promise<number> {
    const result = await this.client.ledgerEntry.aggregate({
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async rebuildAccountBalance(
    accountId: string,
    newBalance: number,
  ): Promise<void> {
    await this.prisma.ledgerAccount.update({
      where: { id: accountId },
      data: { balance: newBalance },
    });
  }

  async reconcileAccountBalance(accountId: string): Promise<{
    accountId: string;
    priorBalance: number;
    correctedBalance: number;
  }> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows: Array<{ id: string; balance: number }> = await tx.$queryRaw`
        SELECT id, balance
        FROM ledger_accounts
        WHERE id = ${accountId}::uuid
        FOR UPDATE
      `;
      if (rows.length === 0) {
        throw new AccountNotFoundException(
          `Ledger account ${accountId} does not exist.`,
        );
      }

      const aggregate = await tx.ledgerEntry.aggregate({
        where: { accountId },
        _sum: { amount: true },
      });
      const priorBalance = rows[0].balance;
      const correctedBalance = aggregate._sum.amount ?? 0;
      if (priorBalance !== correctedBalance) {
        await tx.ledgerAccount.update({
          where: { id: accountId },
          data: { balance: correctedBalance },
        });
      }

      return { accountId, priorBalance, correctedBalance };
    });
  }

  async findTransactionsByUserId(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<UserLedgerTransactionRecord[]> {
    const rawEntries = await this.client.ledgerEntry.findMany({
      where: {
        account: {
          userId,
        },
      },
      include: {
        journal: true,
        account: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.max(1, limit),
      skip: Math.max(0, offset),
    });

    return rawEntries.map((row) => ({
      entry: LedgerEntryEntity.create({
        id: row.id,
        journalId: row.journalId,
        accountId: row.accountId,
        amount: row.amount,
        createdAt: row.createdAt,
      }),
      journal: this.toJournalEntity(row.journal),
      account: this.toAccountEntity(row.account),
    }));
  }

  private toAccountEntity(raw: any): LedgerAccountEntity {
    return LedgerAccountEntity.create({
      id: raw.id,
      userId: raw.userId,
      accountClass: raw.accountClass as LedgerAccountClass,
      currency: raw.currency,
      balance: raw.balance,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  private toJournalEntity(raw: any): LedgerJournalEntity {
    const entries = (raw.entries || []).map((e: any) =>
      LedgerEntryEntity.create({
        id: e.id,
        journalId: e.journalId,
        accountId: e.accountId,
        amount: e.amount,
        createdAt: e.createdAt,
      }),
    );

    return LedgerJournalEntity.create({
      id: raw.id,
      idempotencyKey: raw.idempotencyKey,
      description: raw.description,
      reversesJournalId: raw.reversesJournalId,
      createdAt: raw.createdAt,
      entries,
    });
  }
}
