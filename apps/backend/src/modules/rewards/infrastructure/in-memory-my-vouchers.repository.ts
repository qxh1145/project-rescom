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
  redemptionErrorCodeSchema,
  VoucherPriceSource,
  CodeIssueReason,
  CodeIssueStatus,
} from '@rescom/schemas';
import { VoucherRecord } from '../application/ports/voucher-repository.port';

export class InMemoryMyVouchersRepository
  implements MyVouchersReadPort, TicketWritePort
{
  readonly redemptions = new Map<
    string,
    {
      id: string;
      userId: string;
      voucherId: string;
      voucherCodeId: string | null;
      flashSaleItemId: string | null;
      quoteId: string | null;
      status: string;
      pricePoints: number;
      priceSource: 'BASE' | 'PROMO' | 'FLASH';
      journalId: string | null;
      reference: string;
      createdAt: string;
      failureCode?: string | null;
    }
  >();

  readonly vouchers = new Map<string, VoucherRecord>();
  readonly voucherCodes = new Map<
    string,
    {
      id: string;
      voucherId: string;
      code: string;
      redemptionId: string | null;
      issueReportId: string | null;
      createdAt: string;
    }
  >();

  seedVoucher(voucher: VoucherRecord): void {
    this.vouchers.set(voucher.id, voucher);
  }

  seedCode(code: {
    id: string;
    voucherId: string;
    code: string;
    redemptionId: string | null;
    issueReportId: string | null;
    claimedAt?: Date | null;
  }): void {
    this.voucherCodes.set(code.id, {
      ...code,
      createdAt: new Date().toISOString(),
    });
  }

  seedRedemption(redemption: {
    id: string;
    userId: string;
    voucherId: string;
    voucherCodeId: string | null;
    flashSaleItemId: string | null;
    quoteId: string | null;
    status: string;
    pricePoints: number;
    priceSource: 'BASE' | 'PROMO' | 'FLASH';
    journalId: string | null;
    reference: string;
    createdAt: Date | string;
    failureCode?: string | null;
  }): void {
    this.redemptions.set(redemption.id, {
      ...redemption,
      createdAt:
        typeof redemption.createdAt === 'string'
          ? redemption.createdAt
          : redemption.createdAt.toISOString(),
    });
  }

  readonly usages = new Map<
    string,
    { redemptionId: string; usedAt: Date; undoUntil: Date }
  >();
  readonly refunds = new Map<
    string,
    {
      id: string;
      redemptionId: string;
      reportId: string;
      journalId: string;
      reference: string;
      points: number;
      createdAt: Date;
    }
  >();
  readonly reports = new Map<
    string,
    {
      id: string;
      redemptionId: string;
      reason: CodeIssueReason;
      note: string | null;
      status: CodeIssueStatus;
      createdAt: Date;
      resolvedAt: Date | null;
      replacementCodeId: string | null;
      refundJournalId: string | null;
      resolvedById: string | null;
      resolutionNote: string | null;
    }
  >();
  readonly flashClaims = new Set<string>(); // redemptionId

  // ===================== READ PORT =====================

  /** Code of the newest REPLACED report, regardless of later reports. */
  private latestReplacementCode(redemptionId: string): string | null {
    const replaced = Array.from(this.reports.values())
      .filter(
        (rep) => rep.redemptionId === redemptionId && rep.status === 'REPLACED',
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
    return replaced?.replacementCodeId
      ? (this.voucherCodes.get(replaced.replacementCodeId)?.code ?? null)
      : null;
  }

  async listTickets(userId: string, now: number): Promise<TicketListResult> {
    const list: LockedRedemptionRecord[] = [];
    for (const r of this.redemptions.values()) {
      if (r.userId === userId && r.status === 'SUCCEEDED') {
        const refunded = Array.from(this.refunds.values()).some(
          (ref) => ref.redemptionId === r.id,
        );
        if (!refunded) {
          list.push(this.buildLockedRedemption(r.id)!);
        }
      }
    }

    // Sort by voucher codeExpiresAt asc
    list.sort((a, b) => {
      const va = this.vouchers.get(a.voucherId);
      const vb = this.vouchers.get(b.voucherId);
      return (
        new Date(va?.codeExpiresAt ?? 0).getTime() -
        new Date(vb?.codeExpiresAt ?? 0).getTime()
      );
    });

    const items = list.map((lr) => {
      const v = this.vouchers.get(lr.voucherId)!;
      const originalCode = v.isSharedCode
        ? (v.sharedCode ?? '')
        : (this.voucherCodes.get(lr.voucherCodeId ?? '')?.code ?? '');
      return toVoucherTicket(
        {
          id: lr.id,
          reference: lr.reference,
          pricePoints: lr.pricePoints,
          priceSource: lr.priceSource as VoucherPriceSource,
          createdAt: lr.createdAt,
        },
        v,
        originalCode,
        now,
        {
          usage: lr.usedAt
            ? { usedAt: lr.usedAt, undoUntil: lr.undoUntil! }
            : null,
          latestIssue: lr.latestReport
            ? { id: lr.latestReport.id, status: lr.latestReport.status }
            : null,
          replacementCode: this.latestReplacementCode(lr.id),
        },
      );
    });

    return { items, total: items.length };
  }

  async findTicket(
    userId: string,
    redemptionId: string,
    now: number,
  ): Promise<TicketDetailResult | null> {
    const r = this.redemptions.get(redemptionId);
    if (!r || r.userId !== userId || r.status !== 'SUCCEEDED') return null;

    const lr = this.buildLockedRedemption(redemptionId)!;
    const v = this.vouchers.get(lr.voucherId)!;
    const originalCode = v.isSharedCode
      ? (v.sharedCode ?? '')
      : (this.voucherCodes.get(lr.voucherCodeId ?? '')?.code ?? '');

    const ticket = toVoucherTicket(
      {
        id: lr.id,
        reference: lr.reference,
        pricePoints: lr.pricePoints,
        priceSource: lr.priceSource as VoucherPriceSource,
        createdAt: lr.createdAt,
      },
      v,
      lr.refunded ? '••••' : originalCode,
      now,
      {
        usage: lr.usedAt
          ? { usedAt: lr.usedAt, undoUntil: lr.undoUntil! }
          : null,
        latestIssue: lr.latestReport
          ? { id: lr.latestReport.id, status: lr.latestReport.status }
          : null,
        replacementCode: lr.refunded ? null : this.latestReplacementCode(lr.id),
      },
    );

    return {
      ticket,
      refunded: lr.refunded,
    };
  }

  async listHistory(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<RedemptionHistoryListResult> {
    const entries: any[] = [];

    for (const r of this.redemptions.values()) {
      if (r.userId !== userId) continue;
      const v = this.vouchers.get(r.voucherId)!;
      if (r.status === 'SUCCEEDED') {
        entries.push({
          id: r.id,
          reference: r.reference,
          kind: 'SUCCEEDED',
          voucherTitle: v.title,
          brand: v.brand,
          valueVnd: v.valueVnd,
          isFlash: r.priceSource === 'FLASH',
          points: -r.pricePoints,
          failureCode: null,
          journalId: r.journalId,
          note: null,
          createdAt: r.createdAt,
        });
      } else if (r.status === 'FAILED') {
        entries.push({
          id: r.id,
          reference: r.reference,
          kind: 'FAILED',
          voucherTitle: v.title,
          brand: v.brand,
          valueVnd: v.valueVnd,
          isFlash: r.priceSource === 'FLASH',
          points: 0,
          failureCode: redemptionErrorCodeSchema
            .catch('VOUCHER_UNAVAILABLE')
            .parse(r.failureCode),
          journalId: null,
          note: 'Không trừ điểm',
          createdAt: r.createdAt,
        });
      }
    }

    for (const ref of this.refunds.values()) {
      const red = this.redemptions.get(ref.redemptionId);
      if (!red || red.userId !== userId) continue;
      const v = this.vouchers.get(red.voucherId)!;
      entries.push({
        id: ref.id,
        reference: ref.reference,
        kind: 'REFUNDED',
        voucherTitle: v.title,
        brand: v.brand,
        valueVnd: v.valueVnd,
        isFlash: red.priceSource === 'FLASH',
        points: ref.points,
        failureCode: null,
        journalId: ref.journalId,
        note: null,
        createdAt: ref.createdAt.toISOString(),
      });
    }

    entries.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const monthSummaryRows = entries.map((e) => ({
      kind: e.kind,
      points: e.points,
      createdAt: e.createdAt,
    }));

    const paginated = entries.slice(offset, offset + limit);

    return {
      items: paginated,
      total: entries.length,
      monthSummaryRows,
    };
  }

  // ===================== WRITE PORT =====================

  private buildLockedRedemption(id: string): LockedRedemptionRecord | null {
    const r = this.redemptions.get(id);
    if (!r) return null;

    const usage = this.usages.get(id);
    const refund = Array.from(this.refunds.values()).find(
      (ref) => ref.redemptionId === id,
    );

    // Latest report
    const matchingReports = Array.from(this.reports.values())
      .filter((rep) => rep.redemptionId === id)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    const latest = matchingReports[0] ?? null;

    let replacementCode: string | null = null;
    if (latest?.replacementCodeId) {
      replacementCode =
        this.voucherCodes.get(latest.replacementCodeId)?.code ?? null;
    }

    return {
      id: r.id,
      userId: r.userId,
      voucherId: r.voucherId,
      voucherCodeId: r.voucherCodeId,
      flashSaleItemId: r.flashSaleItemId,
      quoteId: r.quoteId,
      status: r.status,
      pricePoints: r.pricePoints,
      priceSource: r.priceSource,
      journalId: r.journalId,
      reference: r.reference,
      createdAt: r.createdAt,
      codeExpiresAt:
        this.vouchers.get(r.voucherId)?.codeExpiresAt ?? new Date(),
      usedAt: usage?.usedAt ?? null,
      undoUntil: usage?.undoUntil ?? null,
      refunded: !!refund,
      latestReport: latest
        ? {
            id: latest.id,
            reason: latest.reason,
            status: latest.status,
            note: latest.note,
            createdAt: latest.createdAt,
            resolvedAt: latest.resolvedAt,
            replacementCodeId: latest.replacementCodeId,
            replacementCode,
            refundJournalId: latest.refundJournalId,
            resolutionNote: latest.resolutionNote,
          }
        : null,
    };
  }

  async lockRedemption(id: string): Promise<LockedRedemptionRecord | null> {
    return this.buildLockedRedemption(id);
  }

  async insertUsage(params: InsertUsageParams): Promise<void> {
    this.usages.set(params.redemptionId, {
      redemptionId: params.redemptionId,
      usedAt: params.usedAt,
      undoUntil: params.undoUntil,
    });
  }

  async deleteUsage(redemptionId: string): Promise<boolean> {
    return this.usages.delete(redemptionId);
  }

  async insertReport(params: InsertReportParams): Promise<void> {
    this.reports.set(params.id, {
      id: params.id,
      redemptionId: params.redemptionId,
      reason: params.reason,
      note: params.note ?? null,
      status: 'OPEN',
      createdAt: params.createdAt,
      resolvedAt: null,
      replacementCodeId: null,
      refundJournalId: null,
      resolvedById: null,
      resolutionNote: null,
    });
  }

  async findReport(id: string): Promise<LockedReportRecord | null> {
    const r = this.reports.get(id);
    if (!r) return null;
    return { ...r };
  }

  async findRefundPoints(reportId: string): Promise<number | null> {
    for (const ref of this.refunds.values()) {
      if (ref.reportId === reportId) return ref.points;
    }
    return null;
  }

  async lockReport(id: string): Promise<LockedReportRecord | null> {
    return this.findReport(id);
  }

  async markReportReplaced(
    reportId: string,
    replacementCodeId: string,
    resolvedById: string,
    resolvedAt: Date,
    resolutionNote?: string | null,
  ): Promise<boolean> {
    const r = this.reports.get(reportId);
    if (!r || r.status !== 'OPEN') return false;
    r.status = 'REPLACED';
    r.replacementCodeId = replacementCodeId;
    r.resolvedById = resolvedById;
    r.resolvedAt = resolvedAt;
    r.resolutionNote = resolutionNote ?? null;
    return true;
  }

  async markReportRefunded(
    reportId: string,
    refundJournalId: string,
    resolvedById: string,
    resolvedAt: Date,
    resolutionNote?: string | null,
  ): Promise<boolean> {
    const r = this.reports.get(reportId);
    if (!r || r.status !== 'OPEN') return false;
    r.status = 'REFUNDED';
    r.refundJournalId = refundJournalId;
    r.resolvedById = resolvedById;
    r.resolvedAt = resolvedAt;
    r.resolutionNote = resolutionNote ?? null;
    return true;
  }

  async markReportRejected(
    reportId: string,
    resolvedById: string,
    resolvedAt: Date,
    resolutionNote: string,
  ): Promise<boolean> {
    const r = this.reports.get(reportId);
    if (!r || r.status !== 'OPEN') return false;
    r.status = 'REJECTED';
    r.resolvedById = resolvedById;
    r.resolvedAt = resolvedAt;
    r.resolutionNote = resolutionNote;
    return true;
  }

  async claimReplacementCode(
    voucherId: string,
    reportId: string,
  ): Promise<ClaimedVoucherCode | null> {
    for (const code of this.voucherCodes.values()) {
      if (
        code.voucherId === voucherId &&
        code.redemptionId === null &&
        code.issueReportId === null
      ) {
        code.issueReportId = reportId;
        return { id: code.id, code: code.code };
      }
    }
    return null;
  }

  async insertRefund(params: InsertRefundParams): Promise<void> {
    this.refunds.set(params.id, {
      id: params.id,
      redemptionId: params.redemptionId,
      reportId: params.reportId,
      journalId: params.journalId,
      reference: params.reference,
      points: params.points,
      createdAt: params.createdAt,
    });
  }

  async deleteFlashClaim(redemptionId: string): Promise<boolean> {
    return this.flashClaims.delete(redemptionId);
  }

  async listReportsForAdmin(
    params: AdminCodeIssueFilterParams,
    now: number,
  ): Promise<AdminCodeIssueListResult> {
    let all = Array.from(this.reports.values());
    if (params.status === 'OPEN') {
      all = all.filter((r) => r.status === 'OPEN');
    } else if (params.status === 'RESOLVED') {
      all = all.filter((r) => r.status !== 'OPEN');
    }

    // Oldest first
    all.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const openCount = Array.from(this.reports.values()).filter(
      (r) => r.status === 'OPEN',
    ).length;
    const oldestOpen = Array.from(this.reports.values())
      .filter((r) => r.status === 'OPEN')
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )[0];

    const paginated = all.slice(params.offset, params.offset + params.limit);
    const items: AdminCodeIssueDto[] = paginated.map((r) => {
      const red = this.redemptions.get(r.redemptionId)!;
      const v = this.vouchers.get(red.voucherId)!;
      const usage = this.usages.get(red.id);
      const ticketStatus = calculateTicketStatus(
        v.codeExpiresAt,
        usage?.usedAt ?? null,
        now,
      );

      const availableCodes = Array.from(this.voucherCodes.values()).filter(
        (c) =>
          c.voucherId === v.id &&
          c.redemptionId === null &&
          c.issueReportId === null,
      ).length;

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
      } else if (availableCodes <= 0) {
        canReplace = false;
        replaceBlockedReason = 'NO_CODE';
      } else {
        canReplace = true;
      }

      const refund = Array.from(this.refunds.values()).find(
        (ref) => ref.reportId === r.id,
      );
      let resolution: AdminCodeIssueDto['resolution'] = null;
      if (r.status !== 'OPEN') {
        resolution = {
          outcome: r.status,
          refundReference: refund?.reference,
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
        reason: r.reason,
        note: r.note,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolvedBy: r.resolvedById
          ? { id: r.resolvedById, name: 'Admin' }
          : null,
        pricePoints: red.pricePoints,
        priceSource: red.priceSource,
        ticketStatus,
        canReplace,
        replaceBlockedReason,
        resolution,
        resolutionNote: r.resolutionNote,
      };
    });

    return {
      items,
      total: all.length,
      openCount,
      oldestOpenAt: oldestOpen?.createdAt.toISOString() ?? null,
    };
  }

  async findReportForAdmin(
    id: string,
    now: number,
  ): Promise<AdminCodeIssueDto | null> {
    const r = this.reports.get(id);
    if (!r) return null;
    const red = this.redemptions.get(r.redemptionId)!;
    const v = this.vouchers.get(red.voucherId)!;
    const usage = this.usages.get(red.id);
    const ticketStatus = calculateTicketStatus(
      v.codeExpiresAt,
      usage?.usedAt ?? null,
      now,
    );

    const availableCodes = Array.from(this.voucherCodes.values()).filter(
      (c) =>
        c.voucherId === v.id &&
        c.redemptionId === null &&
        c.issueReportId === null,
    ).length;

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
    } else if (availableCodes <= 0) {
      canReplace = false;
      replaceBlockedReason = 'NO_CODE';
    } else {
      canReplace = true;
    }

    const refund = Array.from(this.refunds.values()).find(
      (ref) => ref.reportId === r.id,
    );
    let resolution: AdminCodeIssueDto['resolution'] = null;
    if (r.status !== 'OPEN') {
      resolution = {
        outcome: r.status,
        refundReference: refund?.reference,
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
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedById ? { id: r.resolvedById, name: 'Admin' } : null,
      pricePoints: red.pricePoints,
      priceSource: red.priceSource,
      ticketStatus,
      canReplace,
      replaceBlockedReason,
      resolution,
      resolutionNote: r.resolutionNote,
    };
  }

  readonly reminders = new Map<
    string,
    { redemptionId: string; window: '1D' | '7D'; emittedAt: Date }
  >();

  async findReminderCandidates(
    now: Date,
    limit: number,
  ): Promise<CandidateReminderRecord[]> {
    const nowMs = now.getTime();
    const sevenDaysLaterMs = nowMs + 7 * 86_400_000;
    const candidates: CandidateReminderRecord[] = [];

    for (const r of this.redemptions.values()) {
      if (r.status !== 'SUCCEEDED') continue;
      if (this.usages.has(r.id)) continue;
      const refunded = Array.from(this.refunds.values()).some(
        (ref) => ref.redemptionId === r.id,
      );
      if (refunded) continue;

      const v = this.vouchers.get(r.voucherId);
      if (!v) continue;
      const expiresAtMs = new Date(v.codeExpiresAt).getTime();
      if (expiresAtMs > nowMs && expiresAtMs <= sevenDaysLaterMs) {
        const window = expiresAtMs - nowMs <= 86_400_000 ? '1D' : '7D';
        if (this.reminders.has(`${r.id}:${window}`)) continue;
        candidates.push({
          redemptionId: r.id,
          userId: r.userId,
          voucherId: r.voucherId,
          redeemedAt: new Date(r.createdAt),
          expiresAt: new Date(v.codeExpiresAt),
        });
      }
    }

    candidates.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
    return candidates.slice(0, limit);
  }

  async recordReminderSent(
    redemptionId: string,
    window: '1D' | '7D',
    emittedAt: Date,
  ): Promise<boolean> {
    const key = `${redemptionId}:${window}`;
    if (this.reminders.has(key)) return false;
    this.reminders.set(key, { redemptionId, window, emittedAt });
    return true;
  }
}
