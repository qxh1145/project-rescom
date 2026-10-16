import { payosTransferContent } from '@rescom/schemas';
import { APIError, PayOS } from '@payos/node';
import type { EnvService } from '../../../common/config/env.service';
import {
  PaymentProviderUnavailableError,
  type CreatePaymentInput,
  type CreatedPayment,
  type PaymentProviderPort,
  type ProviderPaymentSnapshot,
  type VerifiedPaymentWebhook,
} from '../application/ports/payment-provider.port';
import { mapPaymentLink, verifyPayosWebhook } from './payos-mapping';
import { UnconfiguredPaymentProvider } from './unconfigured-payment-provider';

export class PayosPaymentProvider implements PaymentProviderPort {
  private readonly client: PayOS;
  constructor(
    private readonly checksumKey: string,
    clientId: string,
    apiKey: string,
    client?: PayOS,
  ) {
    this.client =
      client ??
      new PayOS({
        clientId,
        apiKey,
        checksumKey,
        baseURL: 'https://api-merchant.payos.vn',
        partnerCode: null,
        maxRetries: 0,
        timeout: 10_000,
        logLevel: 'off',
        logger: null,
      });
  }
  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof APIError)
        throw new PaymentProviderUnavailableError(
          'Payment provider unavailable',
          error.code ?? undefined,
          error.desc ?? undefined,
          error.status,
        );
      throw new PaymentProviderUnavailableError();
    }
  }
  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const result = await this.call(() =>
      this.client.paymentRequests.create(
        {
          orderCode: input.orderCode,
          amount: input.amountVnd,
          description: payosTransferContent(input.orderCode),
          returnUrl: input.returnUrl,
          cancelUrl: input.cancelUrl,
          expiredAt: Math.floor(input.expiresAt.getTime() / 1000),
        },
        { maxRetries: 0 },
      ),
    );
    return {
      paymentLinkId: result.paymentLinkId,
      checkoutUrl: result.checkoutUrl,
    };
  }
  async getPayment(
    orderCode: number,
    expectedAmountVnd: number,
  ): Promise<ProviderPaymentSnapshot> {
    return mapPaymentLink(
      await this.call(() => this.client.paymentRequests.get(orderCode)),
      expectedAmountVnd,
    );
  }
  async cancelPayment(orderCode: number, reason?: string): Promise<void> {
    await this.call(() =>
      this.client.paymentRequests.cancel(orderCode, reason),
    );
  }
  async verifyWebhook(body: unknown): Promise<VerifiedPaymentWebhook> {
    return verifyPayosWebhook(body, this.checksumKey);
  }
}

export function createPaymentProvider(env: EnvService): PaymentProviderPort {
  const credentials = env.payosCredentials;
  return credentials
    ? new PayosPaymentProvider(
        credentials.checksumKey,
        credentials.clientId,
        credentials.apiKey,
      )
    : new UnconfiguredPaymentProvider();
}
