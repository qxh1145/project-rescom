export const PAYMENT_PROVIDER_PORT = Symbol('PAYMENT_PROVIDER_PORT');

export interface CreatePaymentInput {
  orderCode: number;
  amountVnd: number;
  returnUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}
export interface CreatedPayment {
  paymentLinkId: string;
  checkoutUrl: string;
}
export type ProviderPaymentEffect =
  'CREDIT' | 'AMOUNT_MISMATCH' | 'NO_CHANGE' | 'CANCELLED' | 'EXPIRED';
export interface ProviderPaymentFacts {
  amountPaidVnd: number;
  providerReference: string | null;
  paidAt: Date | null;
  counterAccountBankId: string | null;
  counterAccountBankName: string | null;
  counterAccountName: string | null;
  counterAccountNumber: string | null;
}
export interface ProviderPaymentSnapshot {
  orderCode: number;
  providerStatus: string;
  effect: ProviderPaymentEffect;
  facts: ProviderPaymentFacts;
}
export interface VerifiedPaymentWebhook {
  orderCode: number;
  paymentLinkId: string;
  code: string;
  dataCode: string;
  amountVnd: number;
  facts: ProviderPaymentFacts;
}
export interface PaymentProviderPort {
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  getPayment(
    orderCode: number,
    expectedAmountVnd: number,
  ): Promise<ProviderPaymentSnapshot>;
  cancelPayment(orderCode: number, reason?: string): Promise<void>;
  verifyWebhook(body: unknown): Promise<VerifiedPaymentWebhook>;
}
export class PaymentProviderSignatureError extends Error {
  constructor() {
    super('Invalid payment webhook signature');
    this.name = 'PaymentProviderSignatureError';
  }
}
export class PaymentProviderUnavailableError extends Error {
  constructor(
    message = 'Payment provider unavailable',
    public readonly providerCode?: string,
    public readonly providerDesc?: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'PaymentProviderUnavailableError';
  }
}
