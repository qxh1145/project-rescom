import { Injectable } from '@nestjs/common';
import { canAccountClassOverdraft, LedgerAccountClass } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import { LedgerRepositoryPort } from '../application/ports/ledger-repository.port';
import { LedgerAccountEntity } from '../domain/ledger-account.entity';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { LedgerEntryEntity } from '../domain/ledger-entry.entity';
import {
  AccountNotFoundException,
  IdempotencyConflictException,
  InsufficientBalanceException,
  JournalAlreadyReversedException,
} from '../application/exceptions/economy.exceptions';

@Injectable()
export class PrismaLedgerRepository implements LedgerRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAccountById(id: string): Promise<LedgerAccountEntity | null> {
    const raw = await this.prisma.ledgerAccount.findUnique({
      where: { id },
    });
    return raw ? this.toAccountEntity(raw) : null;
  }

  async findAccountByUserAndClass(
    userId: string | null,
    accountClass: LedgerAccountClass,
    currency = 'POINTS',
  ): Promise<LedgerAccountEntity | null> {
    const raw = await this.prisma.ledgerAccount.findFirst({
      where: {
        userId,
        accountClass,
        currency,
      },
    });
    return raw ? this.toAccountEntity(raw) : null;
  }

  async findAccountsByUserId(userId: string): Promise<LedgerAccountEntity[]> {
    const list = await this.prisma.ledgerAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return list.map((a) => this.toAccountEntity(a));
  }

  async createAccount(account: LedgerAccountEntity): Promise<LedgerAccountEntity> {
    const created = await this.prisma.ledgerAccount.create({
      data: {
        id: account.id,
        userId: account.userId,
        accountClass: account.accountClass,
        currency: account.currency,
        balance: account.balance,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      },
    });
    return this.toAccountEntity(created);
  }

  async findJournalById(id: string): Promise<LedgerJournalEntity | null> {
    const raw = await this.prisma.ledgerJournal.findUnique({
      where: { id },
      include: { entries: true },
    });
    return raw ? this.toJournalEntity(raw) : null;
  }

  async findJournalByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<LedgerJournalEntity | null> {
    const raw = await this.prisma.ledgerJournal.findUnique({
      where: { idempotencyKey },
      include: { entries: true },
    });
    return raw ? this.toJournalEntity(raw) : null;
  }

  async findReversalJournal(
    targetJournalId: string,
  ): Promise<LedgerJournalEntity | null> {
    const raw = await this.prisma.ledgerJournal.findUnique({
      where: { reversesJournalId: targetJournalId },
      include: { entries: true },
    });
    return raw ? this.toJournalEntity(raw) : null;
  }

  async postJournalTransaction(
    journal: LedgerJournalEntity,
    entries: LedgerEntryEntity[],
  ): Promise<LedgerJournalEntity> {
    return this.prisma.$transaction(async (tx) => {
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

      // 3. Compute net deltas per account
      const deltas = new Map<string, number>();
      for (const entry of entries) {
        deltas.set(entry.accountId, (deltas.get(entry.accountId) || 0) + entry.amount);
      }

      // 4. Enforce overdraft sufficiency for each locked account
      for (const row of lockedAccounts) {
        const delta = deltas.get(row.id) || 0;
        const canOverdraft = canAccountClassOverdraft(row.accountClass);
        if (!canOverdraft && row.balance + delta < 0) {
          throw new InsufficientBalanceException(
            `Account ${row.id} (${row.accountClass}) balance ${row.balance} is insufficient for delta ${delta}.`,
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
    });
  }

  async sumEntriesByAccountId(accountId: string): Promise<number> {
    const result = await this.prisma.ledgerEntry.aggregate({
      where: { accountId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async sumAllEntries(): Promise<number> {
    const result = await this.prisma.ledgerEntry.aggregate({
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async rebuildAccountBalance(accountId: string, newBalance: number): Promise<void> {
    await this.prisma.ledgerAccount.update({
      where: { id: accountId },
      data: { balance: newBalance },
    });
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
