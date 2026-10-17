import { ProviderPaymentFacts } from '../application/ports/payment-provider.port';
import {
  AdminMismatchRow,
  AdminPayosListParams,
  AdminPayosRow,
  AdminRefundDetailRow,
  AdminRefundListItemRow,
  AdminRefundListParams,
  CreateProcessingResult,
  ListReconcileCandidatesParams,
  OverdueRefundCandidateRow,
  PayosTopUp,
  PayosTopUpRepositoryPort,
  TopUpAdminAlertEvent,
  TopUpAdminAuditEvent,
  TopUpRefundRow,
  TopUpRowForRefund,
  TopUpStatusEvent,
  UserTopUpRefundSummary,
} from '../application/ports/payos-top-up-repository.port';
import { TopUpRefundAlreadyRequestedException } from '../application/exceptions/economy.exceptions';

export class InMemoryPayosTopUpRepository implements PayosTopUpRepositoryPort {
  readonly rows = new Map<string, PayosTopUp>();
  readonly events: TopUpStatusEvent[] = [];
  readonly alertEvents: TopUpAdminAlertEvent[] = [];
  readonly auditEvents: TopUpAdminAuditEvent[] = [];
  manualPending = 0;
  manualCount = 0;
  readonly userEmails = new Map<string, string>();
  readonly userNames = new Map<string, string>();
  private nextCode = 1_000_000_000;
  private readonly mismatchJournals = new Map<string, string>();

  readonly refundRequests = new Map<string, TopUpRefundRow>();
  readonly refundRequestsByTopUp = new Map<string, TopUpRefundRow>();
  readonly refundEvents: Array<{
    id: string;
    idempotencyKey: string;
    eventType: string;
    producer: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    payload: Record<string, unknown>;
  }> = [];
  readonly creditJournals = new Map<
    string,
    { id: string; idempotencyKey: string; createdAt: Date }
  >();
  readonly manualTopUps = new Map<string, TopUpRowForRefund>();

  private adminRow(row: PayosTopUp): AdminPayosRow {
    const refund = this.refundRequestsByTopUp.get(row.id);
    return {
      id: row.id,
      userId: row.userId,
      orderCode: row.orderCode,
      amountVnd: row.amountVnd,
      points: row.points,
      pointsCredited: row.pointsCredited,
      amountPaidVnd: row.amountPaidVnd,
      status: row.status,
      createdAt: row.createdAt,
      paidAt: row.paidAt,
      expiresAt: row.expiresAt,
      cancelledAt: row.cancelledAt,
      userEmail: this.userEmails.get(row.userId) ?? null,
      refundStatus: refund?.status ?? null,
      refundResolvedAt: refund?.resolvedAt ?? null,
      bankTransferReference: refund?.bankTransferReference ?? null,
    };
  }

  async listForAdmin(
    params: AdminPayosListParams,
  ): Promise<{ items: AdminPayosRow[]; total: number }> {
    const rows = [...this.rows.values()]
      .filter(
        (row) =>
          (!params.status || row.status === params.status) &&
          (!params.fromUtc || row.createdAt >= params.fromUtc) &&
          (!params.toUtcExclusive || row.createdAt < params.toUtcExclusive) &&
          (params.orderCode === undefined ||
            row.orderCode === params.orderCode) &&
          (!params.emailContains ||
            (this.userEmails.get(row.userId) ?? '')
              .toLowerCase()
              .includes(params.emailContains.toLowerCase())),
      )
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id),
      );
    return {
      items: rows
        .slice(params.offset, params.offset + params.limit)
        .map((row) => this.adminRow(row)),
      total: rows.length,
    };
  }

  async listForExport(params: {
    fromUtc: Date;
    toUtcExclusive: Date;
    limit: number;
  }): Promise<AdminPayosRow[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.createdAt >= params.fromUtc &&
          row.createdAt < params.toUtcExclusive,
      )
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .slice(0, params.limit)
      .map((row) => this.adminRow(row));
  }

  async countByChannel(): Promise<{ payos: number; manual: number }> {
    return { payos: this.rows.size, manual: this.manualCount };
  }

  async listActionRequired({ limit }: { limit: number }): Promise<{
    mismatches: AdminMismatchRow[];
    uncredited: import('@rescom/schemas').AdminPayosUncredited[];
  }> {
    const mismatches = [...this.rows.values()]
      .filter((row) => row.status === 'AMOUNT_MISMATCH')
      .sort(
        (a, b) =>
          (a.paidAt ?? a.createdAt).getTime() -
          (b.paidAt ?? b.createdAt).getTime(),
      )
      .slice(0, limit)
      .map((row) => ({
        ...this.adminRow(row),
        providerReference: row.providerReference,
        counterAccountBankName: row.counterAccountBankName,
        counterAccountLast4: row.counterAccountNumber?.slice(-4) ?? null,
      }));
    const uncredited = this.alertEvents
      .filter((event) =>
        event.idempotencyKey.startsWith(
          'topup-alert:UNCREDITED_AFTER_PAYMENT:',
        ),
      )
      .flatMap((event) => {
        const row = this.rows.get(event.aggregateId);
        if (
          !row ||
          ['SUCCESSFUL', 'MANUAL_REFUNDED', 'AMOUNT_MISMATCH'].includes(
            row.status,
          )
        )
          return [];
        const payload = event.payload;
        return [
          {
            topUpId: row.id,
            orderCode: row.orderCode,
            userId: row.userId,
            userEmail: this.userEmails.get(row.userId) ?? null,
            amountVnd: row.amountVnd,
            amountPaidVnd:
              typeof payload.amountPaidVnd === 'number'
                ? payload.amountPaidVnd
                : row.amountPaidVnd,
            status: row.status,
            paidAt:
              typeof payload.paidAt === 'string'
                ? payload.paidAt
                : (row.paidAt?.toISOString() ?? null),
            alertedAt:
              typeof payload.occurredAt === 'string'
                ? payload.occurredAt
                : row.createdAt.toISOString(),
          },
        ];
      })
      .slice(0, limit);
    return { mismatches, uncredited };
  }

  async isMismatchJournal(journalId: string, key: string): Promise<boolean> {
    return this.mismatchJournals.get(journalId) === key;
  }

  async countActionRequired(): Promise<number> {
    const result = await this.listActionRequired({
      limit: Number.MAX_SAFE_INTEGER,
    });
    return result.mismatches.length + result.uncredited.length;
  }

  async resolveMismatch(
    id: string,
    data: {
      status: 'SUCCESSFUL' | 'MANUAL_REFUNDED';
      expectedAmountPaidVnd: number;
      journalId?: string;
      pointsCredited?: number;
      adminId: string;
      note: string | null;
      correlationId: string | null;
      resolvedAt: Date;
    },
    statusEvent: TopUpStatusEvent,
    auditEvent: TopUpAdminAuditEvent,
  ): Promise<{ changed: boolean }> {
    const row = this.rows.get(id);
    if (
      !row ||
      row.status !== 'AMOUNT_MISMATCH' ||
      row.amountPaidVnd !== data.expectedAmountPaidVnd
    )
      return { changed: false };
    row.status = data.status;
    row.journalId = data.journalId ?? null;
    if (data.journalId)
      this.mismatchJournals.set(data.journalId, statusEvent.idempotencyKey);
    row.pointsCredited = data.pointsCredited ?? null;
    row.resolutionNote = data.note;
    this.events.push(statusEvent);
    this.auditEvents.push(auditEvent);
    return { changed: true };
  }

  async createProcessing(
    input: Pick<
      PayosTopUp,
      'id' | 'userId' | 'amountVnd' | 'points' | 'expiresAt' | 'createdAt'
    >,
    options: { limit: number; windowMs: number; now: Date },
  ): Promise<CreateProcessingResult> {
    const rows = [...this.rows.values()].filter(
      (row) => row.userId === input.userId,
    );
    const existing = rows.find((row) => row.status === 'PROCESSING');
    if (existing) return { outcome: 'ALREADY_PROCESSING', topUp: existing };
    const recent = rows
      .filter(
        (row) =>
          row.createdAt.getTime() > options.now.getTime() - options.windowMs,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (recent.length >= options.limit)
      return {
        outcome: 'RATE_LIMITED',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (recent[0].createdAt.getTime() +
              options.windowMs -
              options.now.getTime()) /
              1000,
          ),
        ),
      };
    const row: PayosTopUp = {
      ...input,
      orderCode: this.nextCode++,
      status: 'PROCESSING',
      paymentLinkId: null,
      checkoutUrl: null,
      cancelledAt: null,
      paidAt: null,
      journalId: null,
      pointsCredited: null,
      amountPaidVnd: null,
      providerReference: null,
      counterAccountBankId: null,
      counterAccountBankName: null,
      counterAccountName: null,
      counterAccountNumber: null,
    };
    this.rows.set(row.id, row);
    return { outcome: 'CREATED', topUp: row };
  }

  async attachPaymentLink(
    id: string,
    link: { paymentLinkId: string; checkoutUrl: string },
  ): Promise<PayosTopUp> {
    const row = this.rows.get(id)!;
    if (!row.paymentLinkId) Object.assign(row, link);
    return row;
  }

  async markCancelled(
    id: string,
    cancelledAt: Date,
    event: TopUpStatusEvent | null,
  ): Promise<{ changed: boolean; topUp: PayosTopUp }> {
    const row = this.rows.get(id)!;
    if (row.status !== 'PROCESSING') return { changed: false, topUp: row };
    row.status = 'CANCELLED';
    row.cancelledAt = cancelledAt;
    if (event) this.events.push(event);
    return { changed: true, topUp: row };
  }

  async findByOrderCode(orderCode: number): Promise<PayosTopUp | null> {
    return (
      [...this.rows.values()].find((row) => row.orderCode === orderCode) ?? null
    );
  }

  async lockForUpdate(id: string): Promise<PayosTopUp | null> {
    return this.rows.get(id) ?? null;
  }

  private storeFacts(
    row: PayosTopUp,
    facts: ProviderPaymentFacts,
    verifiedAt: Date,
    preservePaidAt = false,
  ): void {
    row.amountPaidVnd = facts.amountPaidVnd;
    row.providerReference = facts.providerReference;
    if (!preservePaidAt || !row.paidAt) {
      row.paidAt = facts.paidAt ?? verifiedAt;
    }
    for (const key of [
      'counterAccountBankId',
      'counterAccountBankName',
      'counterAccountName',
      'counterAccountNumber',
    ] as const)
      row[key] ??= facts[key];
  }

  async markSuccessful(
    id: string,
    data: {
      journalId: string;
      pointsCredited: number;
      facts: ProviderPaymentFacts;
      verifiedAt: Date;
    },
    event: TopUpStatusEvent,
  ): Promise<{ changed: boolean }> {
    const row = this.rows.get(id);
    if (
      !row ||
      !['PROCESSING', 'CANCELLED', 'EXPIRED', 'AMOUNT_MISMATCH'].includes(
        row.status,
      )
    )
      return { changed: false };
    row.status = 'SUCCESSFUL';
    row.journalId = data.journalId;
    row.pointsCredited = data.pointsCredited;
    this.storeFacts(row, data.facts, data.verifiedAt);
    this.events.push(event);
    return { changed: true };
  }

  async markAmountMismatch(
    id: string,
    data: {
      facts: ProviderPaymentFacts;
      verifiedAt: Date;
    },
    event: TopUpStatusEvent,
  ): Promise<{ changed: boolean }> {
    const row = this.rows.get(id);
    if (!row) return { changed: false };

    // Standard initial mismatch CAS from PROCESSING/CANCELLED/EXPIRED
    if (['PROCESSING', 'CANCELLED', 'EXPIRED'].includes(row.status)) {
      row.status = 'AMOUNT_MISMATCH';
      this.storeFacts(row, data.facts, data.verifiedAt);
      this.events.push(event);
      return { changed: true };
    }

    // C3: AMOUNT_MISMATCH with a different amountPaidVnd -> refresh facts, keep paidAt
    if (
      row.status === 'AMOUNT_MISMATCH' &&
      row.amountPaidVnd !== data.facts.amountPaidVnd
    ) {
      this.storeFacts(row, data.facts, data.verifiedAt, true);
      this.events.push(event);
      return { changed: true };
    }

    return { changed: false };
  }

  async findOwned(id: string, userId: string): Promise<PayosTopUp | null> {
    const row = this.rows.get(id);
    return row?.userId === userId ? row : null;
  }
  async listByUser(
    userId: string,
    options: { limit: number; offset: number },
  ): Promise<{ items: PayosTopUp[]; total: number }> {
    const userRows = [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => {
        const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
        if (timeDiff !== 0) return timeDiff;
        return b.id.localeCompare(a.id);
      });
    const total = userRows.length;
    const items = userRows.slice(
      options.offset,
      options.offset + options.limit,
    );
    return { items, total };
  }
  async countManualPending(): Promise<number> {
    return this.manualPending;
  }

  async listReconcileCandidates(
    params: ListReconcileCandidatesParams,
  ): Promise<PayosTopUp[]> {
    const dayAgo = params.now.getTime() - 24 * 60 * 60 * 1000;
    const candidates = [...this.rows.values()]
      .filter((row) => {
        if (params.after && row.id <= params.after) return false;
        if (row.status === 'PROCESSING' || row.status === 'AMOUNT_MISMATCH') {
          return true;
        }
        if (row.status === 'CANCELLED' && row.cancelledAt) {
          return row.cancelledAt.getTime() >= dayAgo;
        }
        if (row.status === 'EXPIRED' && row.expiresAt) {
          return row.expiresAt.getTime() >= dayAgo;
        }
        return false;
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, params.limit);
    return candidates;
  }

  async findPayosById(id: string): Promise<PayosTopUp | null> {
    return this.rows.get(id) ?? null;
  }

  async markExpired(
    id: string,
    now: Date,
    event: TopUpStatusEvent,
  ): Promise<{ changed: boolean }> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'PROCESSING') return { changed: false };
    row.status = 'EXPIRED';
    // Do not set cancelledAt for expiration
    this.events.push(event);
    return { changed: true };
  }

  async enqueueAdminAlert(
    event: TopUpAdminAlertEvent,
  ): Promise<{ created: boolean }> {
    const duplicate = this.alertEvents.some(
      (e) => e.idempotencyKey === event.idempotencyKey,
    );
    if (duplicate) {
      return { created: false };
    }
    this.alertEvents.push(event);
    return { created: true };
  }

  async recordAdminAudit(event: TopUpAdminAuditEvent): Promise<void> {
    this.auditEvents.push(event);
  }

  async lockTopUpForRefund(id: string): Promise<TopUpRowForRefund | null> {
    const payos = this.rows.get(id);
    if (payos) {
      return {
        id: payos.id,
        userId: payos.userId,
        channel: 'PAYOS',
        orderCode: payos.orderCode,
        amountVnd: payos.amountVnd,
        points: payos.points,
        status: payos.status,
        paidAt: payos.paidAt,
        journalId: payos.journalId,
        pointsCredited: payos.pointsCredited,
        amountPaidVnd: payos.amountPaidVnd,
        counterAccountBankId: payos.counterAccountBankId,
        counterAccountBankName: payos.counterAccountBankName,
        counterAccountName: payos.counterAccountName,
        counterAccountNumber: payos.counterAccountNumber,
        providerReference: payos.providerReference,
        createdAt: payos.createdAt,
      };
    }
    const manual = this.manualTopUps.get(id);
    if (manual) {
      return manual;
    }
    return null;
  }

  async lockRefundRequestByTopUp(
    topUpId: string,
  ): Promise<TopUpRefundRow | null> {
    return this.refundRequestsByTopUp.get(topUpId) ?? null;
  }

  async createRefundRequest(
    data: Parameters<PayosTopUpRepositoryPort['createRefundRequest']>[0],
    events: Parameters<PayosTopUpRepositoryPort['createRefundRequest']>[1],
  ): Promise<TopUpRefundRow> {
    if (this.refundRequestsByTopUp.has(data.topUpId)) {
      throw new TopUpRefundAlreadyRequestedException();
    }
    const row: TopUpRefundRow = {
      id: data.id,
      topUpId: data.topUpId,
      userId: data.userId,
      topUpJournalId: data.topUpJournalId,
      holdJournalId: data.holdJournalId,
      releaseJournalId: null,
      status: data.status,
      eligibility: data.eligibility,
      ineligibleReason: data.ineligibleReason,
      reason: data.reason,
      note: data.note,
      points: data.points,
      amountVnd: data.amountVnd,
      counterAccountBankId: data.counterAccountBankId,
      counterAccountBankName: data.counterAccountBankName,
      counterAccountName: data.counterAccountName,
      counterAccountNumber: data.counterAccountNumber,
      destinationVerified: data.destinationVerified,
      withdrawnAt: null,
      resolvedAt: null,
      rejectionReason: null,
      manualTransferRecorded: false,
      resolvedByAdminId: null,
      resolveJournalId: null,
      bankTransferReference: null,
      bankTransferredAt: null,
      bankTransferRecordedAt: null,
      correlationId: data.correlationId,
      createdAt: data.createdAt,
      updatedAt: data.createdAt,
    };
    this.refundRequests.set(row.id, row);
    this.refundRequestsByTopUp.set(row.topUpId, row);
    this.refundEvents.push(...events);
    return row;
  }

  async withdrawRefundRequest(
    id: string,
    update: {
      releaseJournalId: string | null;
      withdrawnAt: Date;
    },
    events: Parameters<PayosTopUpRepositoryPort['withdrawRefundRequest']>[2],
  ): Promise<{ changed: boolean; request: TopUpRefundRow }> {
    const row = this.refundRequests.get(id);
    if (!row) {
      throw new Error(`Refund request ${id} not found`);
    }
    if (row.status !== 'REQUESTED') {
      return { changed: false, request: row };
    }
    row.status = 'WITHDRAWN';
    row.withdrawnAt = update.withdrawnAt;
    row.releaseJournalId = update.releaseJournalId;
    row.updatedAt = update.withdrawnAt;
    this.refundEvents.push(...events);
    return { changed: true, request: row };
  }

  async findRefundRequestsByTopUpIds(
    topUpIds: string[],
  ): Promise<Map<string, UserTopUpRefundSummary>> {
    const map = new Map<string, UserTopUpRefundSummary>();
    for (const topUpId of topUpIds) {
      const row = this.refundRequestsByTopUp.get(topUpId);
      if (row) {
        const last4 = row.counterAccountNumber
          ? row.counterAccountNumber.length >= 4
            ? row.counterAccountNumber.slice(-4)
            : row.counterAccountNumber
          : null;
        map.set(topUpId, {
          id: row.id,
          status: row.status,
          eligibility: row.eligibility,
          ineligibleReason: row.ineligibleReason,
          reason: row.reason,
          points: row.points,
          amountVnd: row.amountVnd,
          destination: {
            bankId: row.counterAccountBankId,
            bankName: row.counterAccountBankName,
            holderName: row.counterAccountName,
            last4,
            accountNumber: row.counterAccountNumber,
            verified: row.destinationVerified,
          },
          submittedAt: row.createdAt,
          withdrawnAt: row.withdrawnAt,
          resolvedAt: row.resolvedAt,
          rejectionReason: row.rejectionReason,
          bankTransferReference: row.bankTransferReference,
          bankTransferredAt: row.bankTransferredAt,
        });
      }
    }
    return map;
  }

  async findCreditJournal(
    journalId: string,
  ): Promise<{ id: string; idempotencyKey: string; createdAt: Date } | null> {
    return this.creditJournals.get(journalId) ?? null;
  }

  async findCreditJournalKeysByIds(
    journalIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const id of journalIds) {
      const j = this.creditJournals.get(id);
      if (j) map.set(id, j.idempotencyKey);
    }
    return map;
  }

  async getUserEmail(userId: string): Promise<string | null> {
    return this.userEmails.get(userId) ?? null;
  }

  // Story 13.12: Admin Refund Resolution
  async findRefundRequestById(id: string): Promise<TopUpRefundRow | null> {
    return this.refundRequests.get(id) ?? null;
  }

  async lockRefundRequestById(id: string): Promise<TopUpRefundRow | null> {
    return this.refundRequests.get(id) ?? null;
  }

  async resolveRefundRequest(
    id: string,
    update: Parameters<PayosTopUpRepositoryPort['resolveRefundRequest']>[1],
    events: Parameters<PayosTopUpRepositoryPort['resolveRefundRequest']>[2],
  ): Promise<{ changed: boolean; request: TopUpRefundRow | null }> {
    const row = this.refundRequests.get(id);
    if (!row || row.status !== 'REQUESTED') {
      return { changed: false, request: row ?? null };
    }
    row.status = update.status;
    row.resolvedAt = update.resolvedAt;
    row.resolvedByAdminId = update.resolvedByAdminId;
    row.resolveJournalId = update.resolveJournalId;
    row.rejectionReason = update.rejectionReason;
    row.manualTransferRecorded = update.manualTransferRecorded;
    row.bankTransferReference = update.bankTransferReference;
    row.bankTransferredAt = update.bankTransferredAt;
    row.bankTransferRecordedAt = update.bankTransferRecordedAt;
    row.updatedAt = update.resolvedAt;
    this.refundEvents.push(...events);
    return { changed: true, request: row };
  }

  async recordRefundBankTransfer(
    id: string,
    update: Parameters<PayosTopUpRepositoryPort['recordRefundBankTransfer']>[1],
    events: Parameters<PayosTopUpRepositoryPort['recordRefundBankTransfer']>[2],
  ): Promise<{ changed: boolean; request: TopUpRefundRow | null }> {
    const row = this.refundRequests.get(id);
    if (
      !row ||
      row.status !== 'REFUNDED' ||
      row.bankTransferRecordedAt !== null
    ) {
      return { changed: false, request: row ?? null };
    }
    row.bankTransferReference = update.bankTransferReference;
    row.bankTransferredAt = update.bankTransferredAt;
    row.bankTransferRecordedAt = update.recordedAt;
    row.updatedAt = update.recordedAt;
    this.refundEvents.push(...events);
    return { changed: true, request: row };
  }

  async listRefundRequestsForAdmin(
    params: AdminRefundListParams,
  ): Promise<{ items: AdminRefundListItemRow[]; total: number }> {
    let rows = [...this.refundRequests.values()];

    if (params.status === 'OPEN') {
      rows = rows.filter((r) => r.status === 'REQUESTED');
    } else if (params.status === 'RESOLVED') {
      rows = rows.filter((r) =>
        ['REFUNDED', 'REJECTED', 'WITHDRAWN'].includes(r.status),
      );
    }

    if (params.verdict === 'ELIGIBLE') {
      rows = rows.filter((r) => r.eligibility === 'ELIGIBLE');
    } else if (params.verdict === 'NOT_ELIGIBLE') {
      rows = rows.filter((r) => r.eligibility === 'NOT_ELIGIBLE');
    }

    if (params.q && params.q.trim().length > 0) {
      const q = params.q.trim().toLowerCase();
      const isDigits = /^\d+$/.test(q);
      rows = rows.filter((r) => {
        const topUp =
          this.rows.get(r.topUpId) ?? this.manualTopUps.get(r.topUpId);
        const orderCodeMatch =
          isDigits &&
          topUp?.orderCode !== undefined &&
          topUp?.orderCode !== null
            ? String(topUp.orderCode) === q
            : false;
        const email = (this.userEmails.get(r.userId) ?? '').toLowerCase();
        const emailMatch = email.includes(q);
        return orderCodeMatch || emailMatch;
      });
    }

    if (params.status === 'RESOLVED') {
      rows.sort(
        (a, b) =>
          (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0) ||
          b.id.localeCompare(a.id),
      );
    } else if (params.status === 'ALL') {
      rows.sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id),
      );
    } else {
      // OPEN default
      rows.sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    }

    const total = rows.length;
    const pageRows = rows.slice(
      (params.page - 1) * params.pageSize,
      params.page * params.pageSize,
    );

    const items: AdminRefundListItemRow[] = pageRows.map((r) => {
      const topUp =
        this.rows.get(r.topUpId) ?? this.manualTopUps.get(r.topUpId);
      return {
        id: r.id,
        topUpId: r.topUpId,
        orderCode: topUp?.orderCode ?? 0,
        userId: r.userId,
        userEmail: this.userEmails.get(r.userId) ?? null,
        userName: this.userNames.get(r.userId) ?? null,
        amountVnd: r.amountVnd,
        points: r.points,
        status: r.status,
        eligibility: r.eligibility,
        ineligibleReason: r.ineligibleReason,
        reason: r.reason,
        destinationVerified: r.destinationVerified,
        heldPoints: r.status === 'REQUESTED' && r.holdJournalId ? r.points : 0,
        submittedAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        createdAt: r.createdAt,
      };
    });

    return { items, total };
  }

  async findRefundRequestForAdmin(
    id: string,
  ): Promise<AdminRefundDetailRow | null> {
    const r = this.refundRequests.get(id);
    if (!r) return null;
    const topUp = this.rows.get(r.topUpId) ?? this.manualTopUps.get(r.topUpId);
    return {
      id: r.id,
      topUpId: r.topUpId,
      orderCode: topUp?.orderCode ?? 0,
      userId: r.userId,
      userEmail: this.userEmails.get(r.userId) ?? null,
      userName: this.userNames.get(r.userId) ?? null,
      amountVnd: r.amountVnd,
      points: r.points,
      status: r.status,
      eligibility: r.eligibility,
      ineligibleReason: r.ineligibleReason,
      reason: r.reason,
      destinationVerified: r.destinationVerified,
      heldPoints: r.status === 'REQUESTED' && r.holdJournalId ? r.points : 0,
      submittedAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      createdAt: r.createdAt,
      note: r.note,
      paidAt: topUp?.paidAt ?? r.createdAt,
      providerReference: topUp?.providerReference ?? null,
      counterAccountBankId: r.counterAccountBankId,
      counterAccountBankName: r.counterAccountBankName,
      counterAccountName: r.counterAccountName,
      counterAccountNumber: r.counterAccountNumber,
      rejectionReason: r.rejectionReason,
      manualTransferRecorded: r.manualTransferRecorded,
      bankTransferReference: r.bankTransferReference,
      bankTransferredAt: r.bankTransferredAt,
      bankTransferRecordedAt: r.bankTransferRecordedAt,
      withdrawnAt: r.withdrawnAt,
      resolvedByAdminId: r.resolvedByAdminId,
      resolvedByAdminEmail: r.resolvedByAdminId
        ? (this.userEmails.get(r.resolvedByAdminId) ?? null)
        : null,
      holdJournalId: r.holdJournalId,
      resolveJournalId: r.resolveJournalId,
    };
  }

  async countOpenRefundRequests(): Promise<number> {
    let count = 0;
    for (const r of this.refundRequests.values()) {
      if (r.status === 'REQUESTED') count++;
    }
    return count;
  }

  async listOverdueRefundCandidates(
    cutoff: Date,
  ): Promise<OverdueRefundCandidateRow[]> {
    const list: OverdueRefundCandidateRow[] = [];
    for (const r of this.refundRequests.values()) {
      if (r.status === 'REQUESTED' && r.createdAt <= cutoff) {
        const topUp =
          this.rows.get(r.topUpId) ?? this.manualTopUps.get(r.topUpId);
        list.push({
          id: r.id,
          topUpId: r.topUpId,
          orderCode: topUp?.orderCode ?? 0,
          amountVnd: r.amountVnd,
          createdAt: r.createdAt,
        });
      }
    }
    return list
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, 200);
  }
}
