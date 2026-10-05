import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ESCROW_REFUND_KEY_PREFIX } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  AdminEconomyStatsPort,
  AdminJournalListParams,
  AdminJournalRecord,
  PendingTopUpRecord,
  PendingTopUpSummary,
} from '../application/ports/admin-economy-stats.port';

/**
 * Bounded admin reads of `top_up_requests`, `ledger_accounts` and the journal
 * tables. The journal list walks the `ledger_journals (created_at, id)` index
 * newest first and stops at `limit`.
 */
@Injectable()
export class PrismaAdminEconomyStats implements AdminEconomyStatsPort {
  constructor(private readonly prisma: PrismaService) {}

  async pendingTopUpSummary(): Promise<PendingTopUpSummary> {
    const result = await this.prisma.topUpRequest.aggregate({
      where: { status: 'PENDING' },
      _count: { _all: true },
      _sum: { amount: true, amountVnd: true },
    });
    return {
      count: result._count._all,
      points: result._sum.amount ?? 0,
      amountVnd: result._sum.amountVnd ?? 0,
    };
  }

  async oldestPendingTopUp(): Promise<PendingTopUpRecord | null> {
    return this.prisma.topUpRequest.findFirst({
      where: { status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        userId: true,
        amount: true,
        amountVnd: true,
        transferReference: true,
        createdAt: true,
      },
    });
  }

  async balanceTotals(): Promise<{ escrow: number; pending: number }> {
    const rows = await this.prisma.ledgerAccount.groupBy({
      by: ['accountClass'],
      where: { accountClass: { in: ['ESCROW', 'PENDING'] } },
      _sum: { balance: true },
    });
    const sumOf = (accountClass: string) =>
      rows.find((row) => row.accountClass === accountClass)?._sum.balance ?? 0;
    return { escrow: sumOf('ESCROW'), pending: sumOf('PENDING') };
  }

  async escrowRefundsSince(
    since: Date,
  ): Promise<{ points: number; surveys: number }> {
    // Walks `ledger_journals (created_at, id)` from `since`; a reversal is
    // found through the unique `reverses_journal_id`.
    const [row] = await this.prisma.$queryRaw<
      Array<{ points: number; surveys: number }>
    >`
      SELECT
        COALESCE(sum(e.amount) FILTER (WHERE e.amount > 0), 0)::int AS "points",
        count(DISTINCT split_part(j.idempotency_key, ':', 2))::int AS "surveys"
      FROM ledger_journals j
      JOIN ledger_entries e ON e.journal_id = j.id
      WHERE j.created_at >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        AND j.idempotency_key LIKE ${`${ESCROW_REFUND_KEY_PREFIX}%`}
        AND j.reverses_journal_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM ledger_journals r WHERE r.reverses_journal_id = j.id
        )
    `;
    return { points: row?.points ?? 0, surveys: row?.surveys ?? 0 };
  }

  async listJournals(
    params: AdminJournalListParams,
  ): Promise<AdminJournalRecord[]> {
    const and: Prisma.LedgerJournalWhereInput[] = [];
    if (params.from) and.push({ createdAt: { gte: params.from } });
    if (params.to) and.push({ createdAt: { lte: params.to } });
    if (params.before) {
      and.push({
        OR: [
          { createdAt: { lt: params.before.createdAt } },
          { createdAt: params.before.createdAt, id: { lt: params.before.id } },
        ],
      });
    }
    if (params.filter) {
      const or: Prisma.LedgerJournalWhereInput[] =
        params.filter.keyPrefixes.map((prefix) => ({
          idempotencyKey: { startsWith: prefix },
          reversesJournalId: null,
        }));
      if (params.filter.includeReversals) {
        or.push({ reversesJournalId: { not: null } });
      }
      and.push({ OR: or });
    }

    const rows = await this.prisma.ledgerJournal.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: params.limit,
      select: {
        id: true,
        idempotencyKey: true,
        description: true,
        reversesJournalId: true,
        createdAt: true,
        entries: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            accountId: true,
            amount: true,
            createdAt: true,
            account: { select: { accountClass: true, userId: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      description: row.description,
      reversesJournalId: row.reversesJournalId,
      createdAt: row.createdAt,
      entries: row.entries.map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        amount: entry.amount,
        createdAt: entry.createdAt,
        accountClass: entry.account.accountClass,
        ownerUserId: entry.account.userId,
      })),
    }));
  }
}
