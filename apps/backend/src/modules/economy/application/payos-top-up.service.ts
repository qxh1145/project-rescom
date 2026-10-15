import { randomUUID } from 'crypto';
import {
  PAYOS_TOP_UP_EXPIRY_MS,
  POINT_VND_RATE,
  PayosTopUpDto,
  payosCheckoutSchema,
  TOP_UP_STATUS_CHANGED_EVENT_TYPE,
  topUpCancelKey,
} from '@rescom/schemas';
import {
  PayosTopUp,
  PayosTopUpRepositoryPort,
} from './ports/payos-top-up-repository.port';
import {
  PaymentProviderPort,
  PaymentProviderUnavailableError,
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
      appBaseUrl: string;
      limit: number;
      windowSeconds: number;
      logger: Pick<Console, 'warn'>;
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
  async getOwned(userId: string, id: string): Promise<PayosTopUpDto> {
    const row = await this.options.repository.findOwned(id, userId);
    if (!row) throw new TopUpRequestNotFoundException(id);
    return this.dto(row);
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
