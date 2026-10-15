import {
  PaymentProviderUnavailableError,
  type CreatePaymentInput,
  type CreatedPayment,
  type PaymentProviderPort,
  type ProviderPaymentSnapshot,
  type VerifiedPaymentWebhook,
} from '../application/ports/payment-provider.port';
import {
  mapPaymentLink,
  verifyPayosWebhook,
  type PaymentLinkLike,
} from './payos-mapping';

export class FakePaymentProvider implements PaymentProviderPort {
  readonly createCalls: CreatePaymentInput[] = [];
  readonly cancelCalls: { orderCode: number; reason?: string }[] = [];
  private readonly payments = new Map<number, PaymentLinkLike>();
  private failing: keyof PaymentProviderPort | null = null;
  constructor(private readonly checksumKey: string) {}
  setPayment(orderCode: number, link: PaymentLinkLike): void {
    this.payments.set(orderCode, link);
  }
  failNext(method: keyof PaymentProviderPort): void {
    this.failing = method;
  }
  private check(method: keyof PaymentProviderPort): void {
    if (this.failing === method) {
      this.failing = null;
      throw new PaymentProviderUnavailableError();
    }
  }
  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    this.check('createPayment');
    this.createCalls.push(input);
    return {
      paymentLinkId: String(input.orderCode),
      checkoutUrl: `https://pay.payos.vn/${input.orderCode}`,
    };
  }
  async getPayment(
    orderCode: number,
    expectedAmountVnd: number,
  ): Promise<ProviderPaymentSnapshot> {
    this.check('getPayment');
    const link = this.payments.get(orderCode);
    if (!link) throw new PaymentProviderUnavailableError();
    return mapPaymentLink(link, expectedAmountVnd);
  }
  async cancelPayment(orderCode: number, reason?: string): Promise<void> {
    this.check('cancelPayment');
    this.cancelCalls.push({ orderCode, reason });
  }
  async verifyWebhook(body: unknown): Promise<VerifiedPaymentWebhook> {
    this.check('verifyWebhook');
    return verifyPayosWebhook(body, this.checksumKey);
  }
}
