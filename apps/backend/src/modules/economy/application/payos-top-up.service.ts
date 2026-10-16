import { randomUUID } from 'crypto';
import {
  PAYOS_TOP_UP_EXPIRY_MS,
  PAYOS_TOP_UP_EXPORT_MAX_ROWS,
  adminPayosTopUpSchema,
  listAdminPayosTopUpsQuerySchema,
  exportAdminPayosTopUpsSchema,
  ListAdminPayosTopUpsQuery,
  ExportAdminPayosTopUps,
  vietnamStartOfDay,
  POINT_VND_RATE,
  PayosTopUpDto,
  payosCheckoutSchema,
  TOP_UP_STATUS_CHANGED_EVENT_TYPE,
  topUpCancelKey,
  topUpCreditKey,
  topUpExpireKey,
  topUpMismatchNoticeKey,
  PayosRecheckResult,
  TOP_UP_AUDIT_EVENT_TYPES,
  TopUpRecheckAuditEventPayload,
  topUpExportAuditEventPayloadSchema,
} from '@rescom/schemas';
import { z } from 'zod';
import { toCsv } from '../../../common/http/csv';
import { UnitOfWorkPort } from '../../../common/database/unit-of-work.port';
import { LedgerService } from './ledger.service';
import {
  AdminPayosRow,
  PayosTopUp,
  PayosTopUpRepositoryPort,
  TopUpStatusEvent,
} from './ports/payos-top-up-repository.port';
import {
  PaymentProviderPort,
  PaymentProviderUnavailableError,
  ProviderPaymentEffect,
  ProviderPaymentSnapshot,
} from './ports/payment-provider.port';
import {
  InvalidTopUpRequestException,
  PayosCheckoutRateLimitedException,
  PayosCheckoutUnavailableException,
  PayosTopUpAlreadyProcessingException,
  PayosTopUpNotCancellableException,
  TopUpRequestNotFoundException,
  TopUpExportTooLargeException,
} from './exceptions/economy.exceptions';

export class PayosTopUpService {
  constructor(
    private readonly options: {
      repository: PayosTopUpRepositoryPort;
      provider: PaymentProviderPort;
      unitOfWork: UnitOfWorkPort;
      ledgerService: LedgerService;
      appBaseUrl: string;
      limit: number;
      windowSeconds: number;
      logger: Pick<Console, 'warn' | 'log'>;
      now?: () => Date;
      generateId?: () => string;
    },
  ) {}
  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
  private id(): string {
    return this.options.generateId?.() ?? randomUUID();
  }
  private dateStart(key: string): Date {
    return vietnamStartOfDay(new Date(`${key}T12:00:00+07:00`));
  }

  private adminDto(row: AdminPayosRow) {
    return adminPayosTopUpSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
    });
  }

  async listForAdmin(query: ListAdminPayosTopUpsQuery) {
    const parsed = listAdminPayosTopUpsQuerySchema.parse(query);
    const q = parsed.q;
    const { items, total } = await this.options.repository.listForAdmin({
      limit: parsed.limit,
      offset: parsed.offset,
      status: parsed.status,
      fromUtc: parsed.from ? this.dateStart(parsed.from) : undefined,
      toUtcExclusive: parsed.to
        ? new Date(this.dateStart(parsed.to).getTime() + 86_400_000)
        : undefined,
      // orderCode is a Postgres Int; larger digit strings fall through to email search.
      ...(q && /^\d{1,10}$/.test(q) && Number(q) <= 2_147_483_647
        ? { orderCode: Number(q) }
        : q
          ? { emailContains: q }
          : {}),
    });
    return {
      items: items.map((row) => this.adminDto(row)),
      total,
      limit: parsed.limit,
      offset: parsed.offset,
      hasMore: parsed.offset + items.length < total,
    };
  }

  async tabCounts() {
    return this.options.repository.countByChannel();
  }

  async exportForAdmin(
    input: ExportAdminPayosTopUps & { adminId: string; correlationId?: string },
  ): Promise<string> {
    const { from, to } = exportAdminPayosTopUpsSchema.parse({
      from: input.from,
      to: input.to,
    });
    const rows = await this.options.repository.listForExport({
      fromUtc: this.dateStart(from),
      toUtcExclusive: new Date(this.dateStart(to).getTime() + 86_400_000),
      limit: PAYOS_TOP_UP_EXPORT_MAX_ROWS + 1,
    });
    if (rows.length > PAYOS_TOP_UP_EXPORT_MAX_ROWS) {
      throw new TopUpExportTooLargeException(PAYOS_TOP_UP_EXPORT_MAX_ROWS);
    }
    const exportId = this.id();
    const correlationId = z.string().uuid().safeParse(input.correlationId)
      .success
      ? input.correlationId!
      : null;
    await this.options.repository.recordAdminAudit({
      id: exportId,
      idempotencyKey: `admin-audit:topup-export:${exportId}`,
      eventType: TOP_UP_AUDIT_EVENT_TYPES.EXPORTED,
      producer: 'economy-service',
      aggregateType: 'TopUpExport',
      aggregateId: exportId,
      aggregateVersion: 1,
      payload: topUpExportAuditEventPayloadSchema.parse({
        schemaVersion: 1,
        action: 'TOPUP_EXPORTED',
        auditCategory: 'MODERATION_ADMIN_ACTION',
        exportId,
        adminId: input.adminId,
        from,
        to,
        rowCount: rows.length,
        correlationId,
        occurredAt: this.now().toISOString(),
      }),
    });
    const vnTime = (date: Date | null) =>
      date
        ? new Date(date.getTime() + 7 * 3_600_000)
            .toISOString()
            .replace('Z', '+07:00')
        : null;
    return toCsv(
      [
        'orderCode',
        'userEmail',
        'amountVnd',
        'amountPaidVnd',
        'points',
        'pointsCredited',
        'status',
        'createdAt',
        'paidAt',
      ],
      rows.map((row) => [
        row.orderCode,
        row.userEmail,
        row.amountVnd,
        row.amountPaidVnd,
        row.points,
        row.pointsCredited,
        row.status,
        vnTime(row.createdAt),
        vnTime(row.paidAt),
      ]),
    );
  }

  async checkout(
    userId: string,
    input: unknown,
  ): Promise<{ topUp: PayosTopUpDto; checkoutUrl: string }> {
    const parsed = payosCheckoutSchema.safeParse(input);
    if (!parsed.success) throw new InvalidTopUpRequestException();
    const now = this.now();
    const result = await this.options.repository.createProcessing(
      {
        id: this.id(),
        userId,
        amountVnd: parsed.data.amountVnd,
        points: parsed.data.amountVnd / POINT_VND_RATE,
        expiresAt: new Date(now.getTime() + PAYOS_TOP_UP_EXPIRY_MS),
        createdAt: now,
      },
      {
        limit: this.options.limit,
        windowMs: this.options.windowSeconds * 1000,
        now,
      },
    );
    if (result.outcome === 'ALREADY_PROCESSING')
      throw new PayosTopUpAlreadyProcessingException(
        result.topUp.id,
        result.topUp.checkoutUrl,
      );
    if (result.outcome === 'RATE_LIMITED')
      throw new PayosCheckoutRateLimitedException(result.retryAfterSeconds);
    const row = result.topUp;
    let link;
    try {
      const url = `${this.options.appBaseUrl.replace(/\/$/, '')}/wallet/top-up/${row.id}`;
      link = await this.options.provider.createPayment({
        orderCode: row.orderCode,
        amountVnd: row.amountVnd,
        returnUrl: url,
        cancelUrl: url,
        expiresAt: row.expiresAt,
      });
    } catch (error) {
      await this.abandon(row, 'payOS create failed', error);
      throw new PayosCheckoutUnavailableException();
    }
    let updated: PayosTopUp;
    try {
      updated = await this.options.repository.attachPaymentLink(row.id, link);
    } catch (error) {
      // Link exists but is not stored: kill it so the row cannot block the user.
      await this.options.provider
        .cancelPayment(row.orderCode, 'Lỗi hệ thống')
        .catch(() => undefined);
      await this.abandon(row, 'payOS link attach failed', error);
      throw new PayosCheckoutUnavailableException();
    }
    return { topUp: this.dto(updated), checkoutUrl: link.checkoutUrl };
  }
  private async abandon(
    row: PayosTopUp,
    message: string,
    error: unknown,
  ): Promise<void> {
    const cancelled = await this.options.repository
      .markCancelled(row.id, this.now(), null)
      .then(
        () => true,
        () => false,
      );
    this.options.logger.warn(message, {
      topUpId: row.id,
      orderCode: row.orderCode,
      providerCode:
        error instanceof PaymentProviderUnavailableError
          ? error.providerCode
          : undefined,
      cancelled,
    });
  }
  async cancel(userId: string, id: string): Promise<PayosTopUpDto> {
    const row = await this.options.repository.findOwned(id, userId);
    if (!row) throw new TopUpRequestNotFoundException(id);
    if (row.status === 'CANCELLED') return this.dto(row);
    if (row.status !== 'PROCESSING')
      throw new PayosTopUpNotCancellableException(row.status);
    try {
      await this.options.provider.cancelPayment(
        row.orderCode,
        'Người dùng huỷ',
      );
    } catch (error) {
      this.options.logger.warn('payOS cancel failed', {
        topUpId: id,
        orderCode: row.orderCode,
        providerCode:
          error instanceof PaymentProviderUnavailableError
            ? error.providerCode
            : undefined,
      });
    }
    const now = this.now();
    const { topUp } = await this.options.repository.markCancelled(id, now, {
      id: this.id(),
      idempotencyKey: topUpCancelKey(id),
      eventType: TOP_UP_STATUS_CHANGED_EVENT_TYPE,
      producer: 'economy-service',
      aggregateType: 'TopUpRequest',
      aggregateId: id,
      aggregateVersion: 2,
      payload: {
        schemaVersion: 1,
        topUpId: id,
        userId,
        orderCode: row.orderCode,
        amountVnd: row.amountVnd,
        points: row.points,
        status: 'CANCELLED',
        occurredAt: now.toISOString(),
      },
    });
    return this.dto(topUp);
  }
  async handleWebhook(
    rawBody: unknown,
  ): Promise<{ outcome: 'IGNORED' | 'APPLIED' }> {
    const verified = await this.options.provider.verifyWebhook(rawBody);
    const row = await this.options.repository.findByOrderCode(
      verified.orderCode,
    );
    if (!row) {
      this.options.logger.log('payOS webhook for unknown order', {
        orderCode: verified.orderCode,
      });
      return { outcome: 'IGNORED' };
    }
    if (row.paymentLinkId && row.paymentLinkId !== verified.paymentLinkId) {
      this.options.logger.warn('payOS webhook link mismatch', {
        orderCode: verified.orderCode,
      });
      return { outcome: 'IGNORED' };
    }
    if (verified.code !== '00' || verified.dataCode !== '00') {
      this.options.logger.log('payOS webhook non-success code', {
        orderCode: verified.orderCode,
        code: verified.code,
        dataCode: verified.dataCode,
      });
      return { outcome: 'IGNORED' };
    }
    if (row.status === 'SUCCESSFUL' || row.status === 'MANUAL_REFUNDED')
      return { outcome: 'IGNORED' };
    const snapshot = await this.options.provider.getPayment(
      row.orderCode,
      row.amountVnd,
    );
    if (snapshot.orderCode !== row.orderCode) {
      this.options.logger.warn('payOS payment order mismatch', {
        orderCode: row.orderCode,
      });
      return { outcome: 'IGNORED' };
    }
    const res = await this.applySnapshot(row.id, snapshot);
    return { outcome: res.outcome };
  }
  async applySnapshot(
    topUpId: string,
    snapshot: ProviderPaymentSnapshot,
  ): Promise<{
    outcome: 'IGNORED' | 'APPLIED';
    effect: ProviderPaymentEffect;
  }> {
    let outcome: 'IGNORED' | 'APPLIED' = 'IGNORED';
    if (snapshot.effect === 'CREDIT') {
      const res = await this.creditTopUp(topUpId, snapshot);
      outcome = res.outcome;
    } else if (snapshot.effect === 'AMOUNT_MISMATCH') {
      const res = await this.recordMismatch(topUpId, snapshot);
      outcome = res.outcome;
    } else if (snapshot.effect === 'NO_CHANGE') {
      this.options.logger.log('payOS payment not yet paid', {
        orderCode: snapshot.orderCode,
        providerStatus: snapshot.providerStatus,
      });
    }
    if (
      (snapshot.effect === 'CANCELLED' || snapshot.effect === 'EXPIRED') &&
      snapshot.facts.amountPaidVnd > 0
    ) {
      this.options.logger.warn(
        'payOS reports paid amount on a cancelled/expired link',
        {
          orderCode: snapshot.orderCode,
          providerStatus: snapshot.providerStatus,
        },
      );
    }
    return { outcome, effect: snapshot.effect };
  }
  private event(
    row: PayosTopUp,
    status: 'SUCCESSFUL' | 'AMOUNT_MISMATCH',
    key: string,
    at: Date,
    amountPaidVnd?: number,
  ): TopUpStatusEvent {
    return {
      id: this.id(),
      idempotencyKey: key,
      eventType: TOP_UP_STATUS_CHANGED_EVENT_TYPE,
      producer: 'economy-service',
      aggregateType: 'TopUpRequest',
      aggregateId: row.id,
      aggregateVersion: 3,
      payload: {
        schemaVersion: 1,
        topUpId: row.id,
        userId: row.userId,
        orderCode: row.orderCode,
        amountVnd: row.amountVnd,
        points: row.points,
        status,
        occurredAt: at.toISOString(),
        ...(amountPaidVnd === undefined ? {} : { amountPaidVnd }),
      },
    };
  }
  async creditTopUp(
    topUpId: string,
    snapshot: ProviderPaymentSnapshot,
  ): Promise<{ outcome: 'IGNORED' | 'APPLIED' }> {
    if (snapshot.effect !== 'CREDIT')
      throw new Error('Expected CREDIT payment snapshot');
    return this.options.unitOfWork.run(topUpCreditKey(topUpId), async () => {
      const row = await this.options.repository.lockForUpdate(topUpId);
      if (!row || row.status === 'SUCCESSFUL')
        return { outcome: 'IGNORED' as const };
      if (
        !['PROCESSING', 'CANCELLED', 'EXPIRED', 'AMOUNT_MISMATCH'].includes(
          row.status,
        ) ||
        row.orderCode !== snapshot.orderCode ||
        snapshot.facts.amountPaidVnd !== row.amountVnd
      ) {
        this.options.logger.warn('payOS verified payment not credited', {
          orderCode: snapshot.orderCode,
          status: row.status,
        });
        return { outcome: 'IGNORED' as const };
      }
      const points = row.amountVnd / POINT_VND_RATE;
      const journal = await this.options.ledgerService.creditPayosTopUp({
        topUpId,
        userId: row.userId,
        points,
        orderCode: row.orderCode,
      });
      const verifiedAt = this.now();
      const result = await this.options.repository.markSuccessful(
        topUpId,
        {
          journalId: journal.id,
          pointsCredited: points,
          facts: snapshot.facts,
          verifiedAt,
        },
        this.event(row, 'SUCCESSFUL', topUpCreditKey(topUpId), verifiedAt),
      );
      return {
        outcome: result.changed ? ('APPLIED' as const) : ('IGNORED' as const),
      };
    });
  }
  private async recordMismatch(
    topUpId: string,
    snapshot: ProviderPaymentSnapshot,
  ): Promise<{ outcome: 'IGNORED' | 'APPLIED' }> {
    return this.options.unitOfWork.run(
      `topup-mismatch-record:${topUpId}`,
      async () => {
        const row = await this.options.repository.lockForUpdate(topUpId);
        if (
          !row ||
          !['PROCESSING', 'CANCELLED', 'EXPIRED', 'AMOUNT_MISMATCH'].includes(
            row.status,
          ) ||
          row.orderCode !== snapshot.orderCode
        )
          return { outcome: 'IGNORED' as const };
        const at = this.now();
        const key = topUpMismatchNoticeKey(
          topUpId,
          snapshot.facts.amountPaidVnd,
        );
        const result = await this.options.repository.markAmountMismatch(
          topUpId,
          { facts: snapshot.facts, verifiedAt: at },
          this.event(
            row,
            'AMOUNT_MISMATCH',
            key,
            at,
            snapshot.facts.amountPaidVnd,
          ),
        );
        return {
          outcome: result.changed ? ('APPLIED' as const) : ('IGNORED' as const),
        };
      },
    );
  }
  async expireTopUp(
    topUpId: string,
    now: Date,
    options?: { skipExpiryCheck?: boolean },
  ): Promise<{ outcome: 'IGNORED' | 'APPLIED' }> {
    return this.options.unitOfWork.run(topUpExpireKey(topUpId), async () => {
      const row = await this.options.repository.lockForUpdate(topUpId);
      if (!row || row.status !== 'PROCESSING') {
        return { outcome: 'IGNORED' as const };
      }
      if (!options?.skipExpiryCheck && row.expiresAt > now) {
        return { outcome: 'IGNORED' as const };
      }
      const event: TopUpStatusEvent = {
        id: this.id(),
        idempotencyKey: topUpExpireKey(topUpId),
        eventType: TOP_UP_STATUS_CHANGED_EVENT_TYPE,
        producer: 'economy-service',
        aggregateType: 'TopUpRequest',
        aggregateId: row.id,
        aggregateVersion: 2,
        payload: {
          schemaVersion: 1,
          topUpId: row.id,
          userId: row.userId,
          orderCode: row.orderCode,
          amountVnd: row.amountVnd,
          points: row.points,
          status: 'EXPIRED',
          occurredAt: now.toISOString(),
        },
      };
      const result = await this.options.repository.markExpired(
        topUpId,
        now,
        event,
      );
      return {
        outcome: result.changed ? ('APPLIED' as const) : ('IGNORED' as const),
      };
    });
  }
  async closeFromProvider(
    topUpId: string,
    effect: 'CANCELLED' | 'EXPIRED',
    now: Date,
  ): Promise<{ outcome: 'IGNORED' | 'APPLIED' }> {
    if (effect === 'EXPIRED') {
      return this.expireTopUp(topUpId, now, { skipExpiryCheck: true });
    }
    if (effect === 'CANCELLED') {
      return this.options.unitOfWork.run(topUpCancelKey(topUpId), async () => {
        const row = await this.options.repository.lockForUpdate(topUpId);
        if (!row || row.status !== 'PROCESSING') {
          return { outcome: 'IGNORED' as const };
        }
        const event: TopUpStatusEvent = {
          id: this.id(),
          idempotencyKey: topUpCancelKey(topUpId),
          eventType: TOP_UP_STATUS_CHANGED_EVENT_TYPE,
          producer: 'economy-service',
          aggregateType: 'TopUpRequest',
          aggregateId: row.id,
          aggregateVersion: 2,
          payload: {
            schemaVersion: 1,
            topUpId: row.id,
            userId: row.userId,
            orderCode: row.orderCode,
            amountVnd: row.amountVnd,
            points: row.points,
            status: 'CANCELLED',
            occurredAt: now.toISOString(),
          },
        };
        const result = await this.options.repository.markCancelled(
          topUpId,
          now,
          event,
        );
        return {
          outcome: result.changed ? ('APPLIED' as const) : ('IGNORED' as const),
        };
      });
    }
    return { outcome: 'IGNORED' };
  }
  async recheck(params: {
    topUpId: string;
    adminId: string;
    correlationId?: string;
  }): Promise<PayosRecheckResult> {
    const row = await this.options.repository.findPayosById(params.topUpId);
    if (!row) throw new TopUpRequestNotFoundException(params.topUpId);

    // Capability is verified by RolesGuard at the controller; CreditTopUp moves money without admin identity.
    const auditKey = `admin-audit:topup-recheck:${row.id}:${this.id()}`;
    const now = this.now();
    const statusBefore = row.status;
    const correlationId = z.string().uuid().safeParse(params.correlationId)
      .success
      ? (params.correlationId as string)
      : null;
    const audit = (
      result: TopUpRecheckAuditEventPayload['result'],
      statusAfter: string,
      at: Date,
    ) =>
      this.options.repository.recordAdminAudit({
        id: this.id(),
        idempotencyKey: auditKey,
        eventType: TOP_UP_AUDIT_EVENT_TYPES.RECHECKED,
        producer: 'economy-service',
        aggregateType: 'TopUpRequest',
        aggregateId: row.id,
        aggregateVersion: 1,
        payload: {
          schemaVersion: 1,
          action: 'TOPUP_RECHECKED',
          auditCategory: 'MODERATION_ADMIN_ACTION',
          topUpId: row.id,
          adminId: params.adminId,
          orderCode: row.orderCode,
          result,
          statusBefore,
          statusAfter,
          correlationId,
          occurredAt: at.toISOString(),
        },
      });
    let snapshot: ProviderPaymentSnapshot;
    try {
      snapshot = await this.options.provider.getPayment(
        row.orderCode,
        row.amountVnd,
      );
    } catch (error) {
      if (error instanceof PaymentProviderUnavailableError) {
        await audit('PROVIDER_UNAVAILABLE', statusBefore, now);
      }
      throw error;
    }

    if (snapshot.orderCode !== row.orderCode) {
      this.options.logger.warn('payOS recheck orderCode mismatch', {
        expected: row.orderCode,
        received: snapshot.orderCode,
      });
      await audit('FAILED', statusBefore, now);
      throw new Error('payOS recheck orderCode mismatch');
    }

    try {
      await this.applySnapshot(row.id, snapshot);
    } catch (error) {
      await audit('FAILED', statusBefore, now);
      throw error;
    }

    const reRead = await this.options.repository.findPayosById(row.id);
    const finalRow = reRead ?? row;
    let result: 'CREDITED' | 'STILL_UNPAID' | 'MISMATCH';
    if (finalRow.status === 'SUCCESSFUL') {
      result = 'CREDITED';
    } else if (
      finalRow.status === 'AMOUNT_MISMATCH' ||
      finalRow.status === 'MANUAL_REFUNDED'
    ) {
      result = 'MISMATCH';
    } else {
      result = 'STILL_UNPAID';
    }

    await audit(result, finalRow.status, this.now());

    return {
      topUpId: finalRow.id,
      result,
      status: finalRow.status,
      amountPaidVnd: finalRow.amountPaidVnd,
    };
  }
  async getOwned(userId: string, id: string): Promise<PayosTopUpDto> {
    const row = await this.options.repository.findOwned(id, userId);
    if (!row) throw new TopUpRequestNotFoundException(id);
    return this.dto(row);
  }
  async listOwned(
    userId: string,
    query: { limit: number; offset: number },
  ): Promise<{
    items: PayosTopUpDto[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }> {
    const { items, total } = await this.options.repository.listByUser(
      userId,
      query,
    );
    return {
      items: items.map((row) => this.dto(row)),
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + items.length < total,
    };
  }

  private dto(row: PayosTopUp): PayosTopUpDto {
    return {
      id: row.id,
      orderCode: row.orderCode,
      amountVnd: row.amountVnd,
      points: row.points,
      status: row.status,
      checkoutUrl: row.status === 'PROCESSING' ? row.checkoutUrl : null,
      expiresAt: row.expiresAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
