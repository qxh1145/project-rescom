import { ProviderPaymentFacts } from '../application/ports/payment-provider.port';
import {
  AdminMismatchRow,
  AdminPayosListParams,
  AdminPayosRow,
  CreateProcessingResult,
  ListReconcileCandidatesParams,
  PayosTopUp,
  PayosTopUpRepositoryPort,
  TopUpAdminAlertEvent,
  TopUpAdminAuditEvent,
  TopUpStatusEvent,
} from '../application/ports/payos-top-up-repository.port';

export class InMemoryPayosTopUpRepository implements PayosTopUpRepositoryPort {
  readonly rows = new Map<string, PayosTopUp>();
  readonly events: TopUpStatusEvent[] = [];
  readonly alertEvents: TopUpAdminAlertEvent[] = [];
  readonly auditEvents: TopUpAdminAuditEvent[] = [];
  manualPending = 0;
  manualCount = 0;
  readonly userEmails = new Map<string, string>();
  private nextCode = 1_000_000_000;
  private readonly mismatchJournals = new Map<string, string>();

  private adminRow(row: PayosTopUp): AdminPayosRow {
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
}
