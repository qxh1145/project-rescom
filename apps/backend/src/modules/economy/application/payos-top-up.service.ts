import { randomUUID } from 'crypto';
import {
  PAYOS_TOP_UP_EXPIRY_MS,
  POINT_VND_RATE,
  PayosTopUpDto,
  payosCheckoutSchema,
  TOP_UP_STATUS_CHANGED_EVENT_TYPE,
  topUpCancelKey,
  topUpCreditKey,
  topUpMismatchNoticeKey,
} from '@rescom/schemas';
import { UnitOfWorkPort } from '../../../common/database/unit-of-work.port';
import { LedgerService } from './ledger.service';
import {
  PayosTopUp,
  PayosTopUpRepositoryPort,
  TopUpStatusEvent,
} from './ports/payos-top-up-repository.port';
import {
  PaymentProviderPort,
  PaymentProviderUnavailableError,
  ProviderPaymentSnapshot,
} from './ports/payment-provider.port';
import {
  InvalidTopUpRequestException,
  PayosCheckoutRateLimitedException,
  PayosCheckoutUnavailableException,
  PayosTopUpAlreadyProcessingException,
  PayosTopUpNotCancellableException,
  TopUpRequestNotFoundException,
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
    return this.applySnapshot(row.id, snapshot);
  }
  async applySnapshot(
    topUpId: string,
    snapshot: ProviderPaymentSnapshot,
  ): Promise<{ outcome: 'IGNORED' | 'APPLIED' }> {
    if (snapshot.effect === 'CREDIT')
      return this.creditTopUp(topUpId, snapshot);
    if (snapshot.effect === 'AMOUNT_MISMATCH')
      return this.recordMismatch(topUpId, snapshot);
    if (snapshot.effect === 'NO_CHANGE')
      this.options.logger.log('payOS payment not yet paid', {
        orderCode: snapshot.orderCode,
        providerStatus: snapshot.providerStatus,
      });
    if (
      (snapshot.effect === 'CANCELLED' || snapshot.effect === 'EXPIRED') &&
      snapshot.facts.amountPaidVnd > 0
    )
      this.options.logger.warn(
        'payOS reports paid amount on a cancelled/expired link',
        {
          orderCode: snapshot.orderCode,
          providerStatus: snapshot.providerStatus,
        },
      );
    return { outcome: 'IGNORED' };
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
          !['PROCESSING', 'CANCELLED', 'EXPIRED'].includes(row.status) ||
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
