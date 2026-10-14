import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import {
  MyVouchersReadPort,
  TicketListResult,
  TicketDetailResult,
  RedemptionHistoryListResult,
} from '../application/ports/my-vouchers-read.port';
import {
  TicketWritePort,
  LockedRedemptionRecord,
  LockedReportRecord,
  InsertUsageParams,
  InsertReportParams,
  InsertRefundParams,
  AdminCodeIssueFilterParams,
  AdminCodeIssueListResult,
  CandidateReminderRecord,
} from '../application/ports/ticket-write.port';
import { ClaimedVoucherCode } from '../application/ports/redemption-repository.port';
import { toVoucherTicket } from '../domain/voucher-ticket';
import { calculateTicketStatus } from '../domain/ticket-rules';
import {
  AdminCodeIssueDto,
  VoucherCategory,
  redemptionErrorCodeSchema,
  VoucherPriceSource,
  CodeIssueReason,
  CodeIssueStatus,
} from '@rescom/schemas';
import { VoucherRecord } from '../application/ports/voucher-repository.port';

type VoucherState = VoucherRecord['state'];

const REFUNDED_CODE_MASK = '••••';

@Injectable()
export class PrismaMyVouchersRepository
  implements MyVouchersReadPort, TicketWritePort
{
  constructor(private readonly prisma: PrismaService) {}

  // ===================== READ PORT =====================

  async listTickets(userId: string, now: number): Promise<TicketListResult> {
    const client = currentClient(this.prisma);
    const redemptions = await client.redemption.findMany({
      where: {
        userId,
        status: 'SUCCEEDED',
        refund: null,
      },
      include: {
        voucher: {
          include: { brand: true },
        },
        voucherCode: true,
        usage: true,
        // all reports: latest drives openIssue, latest REPLACED drives the code
        reports: {
          orderBy: { createdAt: 'desc' },
          include: {
            assignedCode: true,
          },
        },
      },
      orderBy: {
        voucher: {
          codeExpiresAt: 'asc',
        },
      },
    });

    const items = redemptions.map((r) => {
      const v = r.voucher;
      const voucherRecord: VoucherRecord = {
        id: v.id,
        title: v.title,
        brand: v.brand,
        category: v.category as VoucherCategory,
        valueVnd: v.valueVnd,
        basePoints: v.basePoints,
        promoPoints: v.promoPoints,
        priceVersion: v.priceVersion,
        stockTotal: v.stockTotal,
        stockRemaining: v.stockRemaining,
        codesAvailable: 0,
        state: v.state as VoucherState,
        isVisible: v.isVisible,
        isSharedCode: v.isSharedCode,
        sharedCode: v.sharedCode,
        redeemStartsAt: v.redeemStartsAt.toISOString(),
        redeemEndsAt: v.redeemEndsAt.toISOString(),
        codeExpiresAt: v.codeExpiresAt.toISOString(),
        description: v.description,
        whereToUse: v.whereToUse,
        terms: v.terms,
        howToUse: v.howToUse,
        imageUrl: v.imageUrl,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
        createdById: v.createdById,
      };

      const originalCode = v.isSharedCode
        ? (v.sharedCode ?? '')
        : (r.voucherCode?.code ?? '');
      const latestReport = r.reports[0] ?? null;
      const replacementCode =
        r.reports.find((x) => x.status === 'REPLACED')?.assignedCode?.code ??
        null;

      return toVoucherTicket(
        {
          id: r.id,
          reference: r.reference,
          pricePoints: r.pricePoints,
          priceSource: r.priceSource as VoucherPriceSource,
          createdAt: r.createdAt,
        },
        voucherRecord,
        originalCode,
        now,
        {
          usage: r.usage,
          latestIssue: latestReport
            ? {
                id: latestReport.id,
                status: latestReport.status as CodeIssueStatus,
              }
            : null,
          replacementCode,
        },
      );
    });

    return {
      items,
      total: items.length,
    };
  }

  async findTicket(
    userId: string,
    redemptionId: string,
    now: number,
  ): Promise<TicketDetailResult | null> {
    const client = currentClient(this.prisma);
    const r = await client.redemption.findFirst({
      where: {
        id: redemptionId,
        userId,
        status: 'SUCCEEDED',
      },
      include: {
        voucher: {
          include: { brand: true },
        },
        voucherCode: true,
        usage: true,
        refund: true,
        // all reports: latest drives openIssue, latest REPLACED drives the code
        reports: {
          orderBy: { createdAt: 'desc' },
          include: {
            assignedCode: true,
          },
        },
      },
    });

    if (!r) return null;

    const v = r.voucher;
    const voucherRecord: VoucherRecord = {
      id: v.id,
      title: v.title,
      brand: v.brand,
      category: v.category as VoucherCategory,
      valueVnd: v.valueVnd,
      basePoints: v.basePoints,
      promoPoints: v.promoPoints,
      priceVersion: v.priceVersion,
      stockTotal: v.stockTotal,
      stockRemaining: v.stockRemaining,
      codesAvailable: 0,
      state: v.state as VoucherState,
      isVisible: v.isVisible,
      isSharedCode: v.isSharedCode,
      sharedCode: v.sharedCode,
      redeemStartsAt: v.redeemStartsAt.toISOString(),
      redeemEndsAt: v.redeemEndsAt.toISOString(),
      codeExpiresAt: v.codeExpiresAt.toISOString(),
      description: v.description,
      whereToUse: v.whereToUse,
      terms: v.terms,
      howToUse: v.howToUse,
      imageUrl: v.imageUrl,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      createdById: v.createdById,
    };

    const originalCode = v.isSharedCode
      ? (v.sharedCode ?? '')
      : (r.voucherCode?.code ?? '');
    const latestReport = r.reports[0] ?? null;
    const replacementCode =
      r.reports.find((x) => x.status === 'REPLACED')?.assignedCode?.code ??
      null;

    const ticket = toVoucherTicket(
      {
        id: r.id,
        reference: r.reference,
        pricePoints: r.pricePoints,
        priceSource: r.priceSource as VoucherPriceSource,
        createdAt: r.createdAt,
      },
      voucherRecord,
      // refunded deep link stays readable but never exposes the code (schema needs >= 4 chars)
      r.refund ? REFUNDED_CODE_MASK : originalCode,
      now,
      {
        usage: r.usage,
        latestIssue: latestReport
          ? {
              id: latestReport.id,
              status: latestReport.status as CodeIssueStatus,
            }
          : null,
        replacementCode: r.refund ? null : replacementCode,
      },
    );

    return {
      ticket,
      refunded: r.refund !== null,
    };
  }

  async listHistory(
    userId: string,
    limit: number,
    offset: number,
    now: number = Date.now(),
  ): Promise<RedemptionHistoryListResult> {
    const client = currentClient(this.prisma);

    // 1. Page + total in the DB: redemptions (SUCCEEDED/FAILED) UNION refunds.
    const [pageRows, totalRows] = await Promise.all([
      client.$queryRaw<Array<{ kind: string; id: string }>>`
        SELECT kind, id FROM (
          SELECT r.status::text AS kind, r.id, r.created_at
          FROM redemptions r
          WHERE r.user_id = ${userId}::uuid AND r.status IN ('SUCCEEDED', 'FAILED')
          UNION ALL
          SELECT 'REFUNDED' AS kind, rf.id, rf.created_at
          FROM redemption_refunds rf
          JOIN redemptions r ON r.id = rf.redemption_id
          WHERE r.user_id = ${userId}::uuid
        ) h
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      client.$queryRaw<Array<{ total: bigint }>>`
        SELECT (
          (SELECT COUNT(*) FROM redemptions WHERE user_id = ${userId}::uuid AND status IN ('SUCCEEDED', 'FAILED'))
          + (SELECT COUNT(*) FROM redemption_refunds rf JOIN redemptions r ON r.id = rf.redemption_id WHERE r.user_id = ${userId}::uuid)
        ) AS total
      `,
    ]);
    const total = Number(totalRows[0]?.total ?? 0);

    // 2. Details for the page only.
    const redemptionIds = pageRows
      .filter((p) => p.kind !== 'REFUNDED')
      .map((p) => p.id);
    const refundIds = pageRows
      .filter((p) => p.kind === 'REFUNDED')
      .map((p) => p.id);
    const [redemptions, refunds] = await Promise.all([
      client.redemption.findMany({
        where: { id: { in: redemptionIds } },
        include: { voucher: { include: { brand: true } } },
      }),
      client.redemptionRefund.findMany({
        where: { id: { in: refundIds } },
        include: {
          redemption: { include: { voucher: { include: { brand: true } } } },
        },
      }),
    ]);
    const redemptionById = new Map(redemptions.map((r) => [r.id, r]));
    const refundById = new Map(refunds.map((r) => [r.id, r]));

    const items: RedemptionHistoryListResult['items'] = [];
    for (const row of pageRows) {
      if (row.kind === 'REFUNDED') {
        const ref = refundById.get(row.id);
        if (!ref) continue;
        items.push({
          id: ref.id,
          reference: ref.reference,
          kind: 'REFUNDED',
          voucherTitle: ref.redemption.voucher.title,
          brand: ref.redemption.voucher.brand,
          valueVnd: ref.redemption.voucher.valueVnd,
          isFlash: ref.redemption.priceSource === 'FLASH',
          points: ref.points,
          failureCode: null,
          journalId: ref.journalId,
          note: null,
          createdAt: ref.createdAt.toISOString(),
        });
        continue;
      }
      const r = redemptionById.get(row.id);
      if (!r) continue;
      const failed = row.kind === 'FAILED';
      items.push({
        id: r.id,
        reference: r.reference,
        kind: failed ? 'FAILED' : 'SUCCEEDED',
        voucherTitle: r.voucher.title,
        brand: r.voucher.brand,
        valueVnd: r.voucher.valueVnd,
        isFlash: r.priceSource === 'FLASH',
        points: failed ? 0 : -r.pricePoints,
        failureCode: failed
          ? redemptionErrorCodeSchema
              .catch('VOUCHER_UNAVAILABLE')
              .parse(r.failureCode)
          : null,
        journalId: failed ? null : r.journalId,
        note: failed ? 'Không trừ điểm' : null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    // 3. Month summary only needs recent rows (a month is < 40 days).
    const since = new Date(now - 40 * 86_400_000);
    const [recentRedemptions, recentRefunds] = await Promise.all([
      client.redemption.findMany({
        where: { userId, status: 'SUCCEEDED', createdAt: { gte: since } },
        select: { pricePoints: true, createdAt: true },
      }),
      client.redemptionRefund.findMany({
        where: { redemption: { userId }, createdAt: { gte: since } },
        select: { points: true, createdAt: true },
      }),
    ]);
    const monthSummaryRows = [
      ...recentRedemptions.map((r) => ({
        kind: 'SUCCEEDED' as const,
        points: -r.pricePoints,
        createdAt: r.createdAt.toISOString(),
      })),
      ...recentRefunds.map((r) => ({
        kind: 'REFUNDED' as const,
        points: r.points,
        createdAt: r.createdAt.toISOString(),
      })),
    ];

    return { items, total, monthSummaryRows };
  }

  // ===================== WRITE PORT =====================

  async lockRedemption(id: string): Promise<LockedRedemptionRecord | null> {
    const client = currentClient(this.prisma);
    const rows = await client.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        voucher_id: string;
        voucher_code_id: string | null;
        flash_sale_item_id: string | null;
        quote_id: string | null;
        status: string;
        price_points: number;
        price_source: 'BASE' | 'PROMO' | 'FLASH';
        journal_id: string | null;
        reference: string;
        created_at: Date;
      }>
    >`
      SELECT id, user_id, voucher_id, voucher_code_id, flash_sale_item_id, quote_id,
             status, price_points, price_source, journal_id, reference, created_at
      FROM redemptions
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;

    if (!rows.length) return null;
    const r = rows[0];

    const usage = await client.redemptionUsage.findUnique({
      where: { redemptionId: id },
    });
    const refund = await client.redemptionRefund.findUnique({
      where: { redemptionId: id },
    });
    const voucher = await client.voucher.findUnique({
      where: { id: r.voucher_id },
      select: { codeExpiresAt: true },
    });
    const latestReport = await client.codeIssueReport.findFirst({
      where: { redemptionId: id },
      orderBy: { createdAt: 'desc' },
      include: { assignedCode: true },
    });

    return {
      id: r.id,
      userId: r.user_id,
      voucherId: r.voucher_id,
      voucherCodeId: r.voucher_code_id,
      flashSaleItemId: r.flash_sale_item_id,
      quoteId: r.quote_id,
      status: r.status,
      pricePoints: r.price_points,
      priceSource: r.price_source,
      journalId: r.journal_id,
      reference: r.reference,
      createdAt: r.created_at,
      codeExpiresAt: voucher?.codeExpiresAt ?? new Date(),
      usedAt: usage?.usedAt ?? null,
      undoUntil: usage?.undoUntil ?? null,
      refunded: refund !== null,
      latestReport: latestReport
        ? {
            id: latestReport.id,
            reason: latestReport.reason as CodeIssueReason,
            status: latestReport.status as CodeIssueStatus,
            note: latestReport.note,
            createdAt: latestReport.createdAt,
            resolvedAt: latestReport.resolvedAt,
            replacementCodeId: latestReport.replacementCodeId,
            replacementCode: latestReport.assignedCode?.code ?? null,
            refundJournalId: latestReport.refundJournalId,
            resolutionNote: latestReport.resolutionNote,
          }
        : null,
    };
  }

  async insertUsage(params: InsertUsageParams): Promise<void> {
    const client = currentClient(this.prisma);
    await client.redemptionUsage.create({
      data: {
        redemptionId: params.redemptionId,
        usedAt: params.usedAt,
        undoUntil: params.undoUntil,
      },
    });
  }

  async deleteUsage(redemptionId: string): Promise<boolean> {
    const client = currentClient(this.prisma);
    const count = await client.$executeRaw`
      DELETE FROM redemption_usages WHERE redemption_id = ${redemptionId}::uuid
    `;
    return count > 0;
  }

  async insertReport(params: InsertReportParams): Promise<void> {
    const client = currentClient(this.prisma);
    await client.codeIssueReport.create({
      data: {
        id: params.id,
        redemptionId: params.redemptionId,
        reason: params.reason,
        note: params.note,
        status: 'OPEN',
        createdAt: params.createdAt,
      },
    });
  }

  async findReport(id: string): Promise<LockedReportRecord | null> {
    const client = currentClient(this.prisma);
    const row = await client.codeIssueReport.findUnique({
      where: { id },
    });
    if (!row) return null;
    return {
      id: row.id,
      redemptionId: row.redemptionId,
      reason: row.reason as CodeIssueReason,
      note: row.note,
      status: row.status as CodeIssueStatus,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      replacementCodeId: row.replacementCodeId,
      refundJournalId: row.refundJournalId,
      resolvedById: row.resolvedById,
      resolutionNote: row.resolutionNote,
    };
  }

  async findRefundPoints(reportId: string): Promise<number | null> {
    const client = currentClient(this.prisma);
    const refund = await client.redemptionRefund.findUnique({
      where: { reportId },
      select: { points: true },
    });
    return refund?.points ?? null;
  }

  async lockReport(id: string): Promise<LockedReportRecord | null> {
    const client = currentClient(this.prisma);
    const rows = await client.$queryRaw<
      Array<{
        id: string;
        redemption_id: string;
        reason: string;
        note: string | null;
        status: string;
        created_at: Date;
        resolved_at: Date | null;
        replacement_code_id: string | null;
        refund_journal_id: string | null;
        resolved_by_id: string | null;
        resolution_note: string | null;
      }>
    >`
      SELECT id, redemption_id, reason, note, status, created_at, resolved_at,
             replacement_code_id, refund_journal_id, resolved_by_id, resolution_note
      FROM code_issue_reports
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      redemptionId: r.redemption_id,
      reason: r.reason as CodeIssueReason,
      note: r.note,
      status: r.status as CodeIssueStatus,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      replacementCodeId: r.replacement_code_id,
      refundJournalId: r.refund_journal_id,
      resolvedById: r.resolved_by_id,
      resolutionNote: r.resolution_note,
    };
  }

  async markReportReplaced(
    reportId: string,
    replacementCodeId: string,
    resolvedById: string,
    resolvedAt: Date,
    resolutionNote?: string | null,
  ): Promise<boolean> {
    const client = currentClient(this.prisma);
    const count = await client.$executeRaw`
      UPDATE code_issue_reports
      SET status = 'REPLACED',
          replacement_code_id = ${replacementCodeId}::uuid,
          resolved_by_id = ${resolvedById}::uuid,
          resolved_at = ${resolvedAt},
          resolution_note = ${resolutionNote ?? null}
      WHERE id = ${reportId}::uuid AND status = 'OPEN'
    `;
    return count === 1;
  }

  async markReportRefunded(
    reportId: string,
    refundJournalId: string,
    resolvedById: string,
    resolvedAt: Date,
    resolutionNote?: string | null,
  ): Promise<boolean> {
    const client = currentClient(this.prisma);
    const count = await client.$executeRaw`
      UPDATE code_issue_reports
      SET status = 'REFUNDED',
          refund_journal_id = ${refundJournalId}::uuid,
          resolved_by_id = ${resolvedById}::uuid,
          resolved_at = ${resolvedAt},
          resolution_note = ${resolutionNote ?? null}
      WHERE id = ${reportId}::uuid AND status = 'OPEN'
    `;
    return count === 1;
  }

  async markReportRejected(
    reportId: string,
    resolvedById: string,
    resolvedAt: Date,
    resolutionNote: string,
  ): Promise<boolean> {
    const client = currentClient(this.prisma);
    const count = await client.$executeRaw`
      UPDATE code_issue_reports
      SET status = 'REJECTED',
          resolved_by_id = ${resolvedById}::uuid,
          resolved_at = ${resolvedAt},
          resolution_note = ${resolutionNote}
      WHERE id = ${reportId}::uuid AND status = 'OPEN'
    `;
    return count === 1;
  }

  async claimReplacementCode(
    voucherId: string,
    reportId: string,
  ): Promise<ClaimedVoucherCode | null> {
    const client = currentClient(this.prisma);
    const selected = await client.$queryRaw<
      Array<{ id: string; code: string }>
    >`
      SELECT "id", "code"
      FROM "voucher_codes"
      WHERE "voucher_id" = ${voucherId}::uuid
        AND "redemption_id" IS NULL
        AND "issue_report_id" IS NULL
      ORDER BY "created_at" ASC, "id" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (!selected.length) return null;
    const codeRow = selected[0];

    const affected = await client.$executeRaw`
      UPDATE "voucher_codes"
      SET "issue_report_id" = ${reportId}::uuid
      WHERE "id" = ${codeRow.id}::uuid
        AND "issue_report_id" IS NULL
        AND "redemption_id" IS NULL
    `;
    if (affected !== 1) return null;

    return {
      id: codeRow.id,
      code: codeRow.code,
    };
  }

  async insertRefund(params: InsertRefundParams): Promise<void> {
    const client = currentClient(this.prisma);
    await client.redemptionRefund.create({
      data: {
        id: params.id,
        redemptionId: params.redemptionId,
        reportId: params.reportId,
        journalId: params.journalId,
        reference: params.reference,
        points: params.points,
        createdAt: params.createdAt,
      },
    });
  }

  async deleteFlashClaim(redemptionId: string): Promise<boolean> {
    const client = currentClient(this.prisma);
    const count = await client.$executeRaw`
      DELETE FROM flash_item_claims WHERE redemption_id = ${redemptionId}::uuid
    `;
    return count > 0;
  }

  async listReportsForAdmin(
    params: AdminCodeIssueFilterParams,
    now: number,
  ): Promise<AdminCodeIssueListResult> {
    const client = currentClient(this.prisma);
    const where: Prisma.CodeIssueReportWhereInput = {};
    if (params.status === 'OPEN') {
      where.status = 'OPEN';
    } else if (params.status === 'RESOLVED') {
      where.status = { in: ['REPLACED', 'REFUNDED', 'REJECTED'] };
    }

    const [reports, total, openCount, oldestOpen] = await Promise.all([
      client.codeIssueReport.findMany({
        where,
        include: {
          redemption: {
            include: {
              voucher: {
                include: {
                  brand: true,
                  _count: {
                    select: {
                      codes: {
                        where: { redemptionId: null, issueReportId: null },
                      },
                    },
                  },
                },
              },
              usage: true,
              refund: true,
            },
          },
          refund: true,
        },
        orderBy: { createdAt: 'asc' }, // oldest first
        take: params.limit,
        skip: params.offset,
      }),
      client.codeIssueReport.count({ where }),
      client.codeIssueReport.count({ where: { status: 'OPEN' } }),
      client.codeIssueReport.findFirst({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const adminNames = await this.adminNames(
      client,
      reports.map((r) => r.resolvedById),
    );
    const items = reports.map((r) => {
      const red = r.redemption;
      const v = red.voucher;
      const ticketStatus = calculateTicketStatus(
        v.codeExpiresAt,
        red.usage?.usedAt ?? null,
        now,
      );

      let canReplace = false;
      let replaceBlockedReason:
        'SHARED_CODE' | 'NO_STOCK' | 'NO_CODE' | 'TICKET_EXPIRED' | null = null;

      if (r.status !== 'OPEN') {
        canReplace = false;
      } else if (v.isSharedCode) {
        canReplace = false;
        replaceBlockedReason = 'SHARED_CODE';
      } else if (now >= +new Date(v.codeExpiresAt)) {
        canReplace = false;
        replaceBlockedReason = 'TICKET_EXPIRED';
      } else if (v.stockRemaining <= 0) {
        canReplace = false;
        replaceBlockedReason = 'NO_STOCK';
      } else if (v._count.codes <= 0) {
        canReplace = false;
        replaceBlockedReason = 'NO_CODE';
      } else {
        canReplace = true;
      }

      let resolution: AdminCodeIssueDto['resolution'] = null;
      if (r.status !== 'OPEN') {
        resolution = {
          outcome: r.status as 'REPLACED' | 'REFUNDED' | 'REJECTED',
          refundReference: r.refund?.reference,
        };
      }

      const dto: AdminCodeIssueDto = {
        id: r.id,
        redemptionId: red.id,
        reference: red.reference,
        userLabel: `#${red.userId.slice(0, 4).toUpperCase()}`,
        voucher: {
          id: v.id,
          title: v.title,
          brand: v.brand,
        },
        reason: r.reason as CodeIssueReason,
        note: r.note,
        status: r.status as CodeIssueStatus,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolvedBy: r.resolvedById
          ? {
              id: r.resolvedById,
              name: adminNames.get(r.resolvedById) ?? 'Admin',
            }
          : null,
        pricePoints: red.pricePoints,
        priceSource: red.priceSource as 'BASE' | 'PROMO' | 'FLASH',
        ticketStatus,
        canReplace,
        replaceBlockedReason,
        resolution,
        resolutionNote: r.resolutionNote,
      };
      return dto;
    });

    return {
      items,
      total,
      openCount,
      oldestOpenAt: oldestOpen?.createdAt.toISOString() ?? null,
    };
  }

  async findReportForAdmin(
    id: string,
    now: number,
  ): Promise<AdminCodeIssueDto | null> {
    const client = currentClient(this.prisma);
    const r = await client.codeIssueReport.findUnique({
      where: { id },
      include: {
        redemption: {
          include: {
            voucher: {
              include: {
                brand: true,
                _count: {
                  select: {
                    codes: {
                      where: { redemptionId: null, issueReportId: null },
                    },
                  },
                },
              },
            },
            usage: true,
            refund: true,
          },
        },
        refund: true,
      },
    });

    if (!r) return null;

    const red = r.redemption;
    const v = red.voucher;
    const ticketStatus = calculateTicketStatus(
      v.codeExpiresAt,
      red.usage?.usedAt ?? null,
      now,
    );

    let canReplace = false;
    let replaceBlockedReason:
      'SHARED_CODE' | 'NO_STOCK' | 'NO_CODE' | 'TICKET_EXPIRED' | null = null;

    if (r.status !== 'OPEN') {
      canReplace = false;
    } else if (v.isSharedCode) {
      canReplace = false;
      replaceBlockedReason = 'SHARED_CODE';
    } else if (now >= +new Date(v.codeExpiresAt)) {
      canReplace = false;
      replaceBlockedReason = 'TICKET_EXPIRED';
    } else if (v.stockRemaining <= 0) {
      canReplace = false;
      replaceBlockedReason = 'NO_STOCK';
    } else if (v._count.codes <= 0) {
      canReplace = false;
      replaceBlockedReason = 'NO_CODE';
    } else {
      canReplace = true;
    }

    let resolution: AdminCodeIssueDto['resolution'] = null;
    if (r.status !== 'OPEN') {
      resolution = {
        outcome: r.status as 'REPLACED' | 'REFUNDED' | 'REJECTED',
        refundReference: r.refund?.reference,
      };
    }

    return {
      id: r.id,
      redemptionId: red.id,
      reference: red.reference,
      userLabel: `#${red.userId.slice(0, 4).toUpperCase()}`,
      voucher: {
        id: v.id,
        title: v.title,
        brand: v.brand,
      },
      reason: r.reason as CodeIssueReason,
      note: r.note,
      status: r.status as CodeIssueStatus,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedById
        ? {
            id: r.resolvedById,
            name:
              (await this.adminNames(client, [r.resolvedById])).get(
                r.resolvedById,
              ) ?? 'Admin',
          }
        : null,
      pricePoints: red.pricePoints,
      priceSource: red.priceSource as 'BASE' | 'PROMO' | 'FLASH',
      ticketStatus,
      canReplace,
      replaceBlockedReason,
      resolution,
      resolutionNote: r.resolutionNote,
    };
  }

  /** Admins have no display name; their email identifies who resolved. */
  private async adminNames(
    client: ReturnType<typeof currentClient>,
    ids: Array<string | null>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const users = await client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, email: true },
    });
    return new Map(users.map((u) => [u.id, u.email]));
  }

  async findReminderCandidates(
    now: Date,
    limit: number,
  ): Promise<CandidateReminderRecord[]> {
    const client = currentClient(this.prisma);
    const sevenDaysLater = new Date(now.getTime() + 7 * 86_400_000);
    const rows = await client.$queryRaw<
      Array<{
        redemption_id: string;
        user_id: string;
        voucher_id: string;
        redeemed_at: Date;
        expires_at: Date;
      }>
    >`
      SELECT r.id AS redemption_id, r.user_id, r.voucher_id, r.created_at AS redeemed_at, v.code_expires_at AS expires_at
      FROM redemptions r
      JOIN vouchers v ON v.id = r.voucher_id
      WHERE r.status = 'SUCCEEDED'
        AND v.code_expires_at > ${now}
        AND v.code_expires_at <= ${sevenDaysLater}
        AND NOT EXISTS (SELECT 1 FROM redemption_usages u WHERE u.redemption_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM redemption_refunds ref WHERE ref.redemption_id = r.id)
        -- skip tickets redeemed inside the window: dueReminderWindow would reject them anyway
        AND (v.code_expires_at > ${new Date(now.getTime() + 86_400_000)} OR r.created_at <= v.code_expires_at - interval '1 day')
        AND (v.code_expires_at <= ${new Date(now.getTime() + 86_400_000)} OR r.created_at <= v.code_expires_at - interval '7 days')
        AND NOT EXISTS (
          SELECT 1 FROM redemption_reminders sent
          WHERE sent.redemption_id = r.id
            AND sent."window" = CASE
              WHEN v.code_expires_at <= ${new Date(now.getTime() + 86_400_000)} THEN '1D'
              ELSE '7D'
            END
        )
      ORDER BY v.code_expires_at ASC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      redemptionId: r.redemption_id,
      userId: r.user_id,
      voucherId: r.voucher_id,
      redeemedAt: r.redeemed_at,
      expiresAt: r.expires_at,
    }));
  }

  async recordReminderSent(
    redemptionId: string,
    window: '1D' | '7D',
    emittedAt: Date,
  ): Promise<boolean> {
    const client = currentClient(this.prisma);
    const affected = await client.$executeRaw`
      INSERT INTO redemption_reminders (redemption_id, "window", emitted_at)
      VALUES (${redemptionId}::uuid, ${window}, ${emittedAt})
      ON CONFLICT (redemption_id, "window") DO NOTHING
    `;
    return affected > 0;
  }
}
