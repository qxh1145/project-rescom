import {
  PaymentProviderUnavailableError,
  type ConfirmedWebhook,
  type CreatePaymentInput,
  type CreatedPayment,
  type PaymentProviderPort,
  type ProviderPaymentSnapshot,
  type VerifiedPaymentWebhook,
} from '../application/ports/payment-provider.port';
export class UnconfiguredPaymentProvider implements PaymentProviderPort {
  confirmWebhook(_webhookUrl: string): Promise<ConfirmedWebhook> {
    return Promise.reject(
      new PaymentProviderUnavailableError('payOS is not configured'),
    );
  }
  getPaymentRecord(_orderCode: number): Promise<unknown> {
    return Promise.reject(
      new PaymentProviderUnavailableError('payOS is not configured'),
    );
  }
  createPayment(_input: CreatePaymentInput): Promise<CreatedPayment> {
    return Promise.reject(
      new PaymentProviderUnavailableError('payOS is not configured'),
    );
  }
  getPayment(
    _orderCode: number,
    _expectedAmountVnd: number,
  ): Promise<ProviderPaymentSnapshot> {
    return Promise.reject(
      new PaymentProviderUnavailableError('payOS is not configured'),
    );
  }
  cancelPayment(_orderCode: number, _reason?: string): Promise<void> {
    return Promise.reject(
      new PaymentProviderUnavailableError('payOS is not configured'),
    );
  }
  verifyWebhook(_body: unknown): Promise<VerifiedPaymentWebhook> {
    return Promise.reject(
      new PaymentProviderUnavailableError('payOS is not configured'),
    );
  }
}
