import {
  buildPaymentLink,
  buildPayosWebhookData,
  PAYOS_TEST_CHECKSUM_KEY,
  signPayosWebhook,
} from '../../../../test/fixtures/payos-webhook.fixture';
import { PaymentProviderUnavailableError } from '../application/ports/payment-provider.port';
import { FakePaymentProvider } from './fake-payment-provider';
import { UnconfiguredPaymentProvider } from './unconfigured-payment-provider';

describe('fake payment provider', () => {
  it('records calls and maps scripted GET state', async () => {
    const fake = new FakePaymentProvider(PAYOS_TEST_CHECKSUM_KEY);
    const input = {
      orderCode: 1234567890,
      amountVnd: 20000,
      expiresAt: new Date(),
      returnUrl: 'return',
      cancelUrl: 'cancel',
    };
    await fake.createPayment(input);
    expect(fake.createCalls).toEqual([input]);
    const link = buildPaymentLink();
    fake.setPayment(input.orderCode, link);
    await expect(fake.getPaymentRecord(input.orderCode)).resolves.toBe(link);
    await expect(
      fake.confirmWebhook('https://example.test/webhook'),
    ).resolves.toEqual({
      webhookUrl: 'https://example.test/webhook',
      accountName: 'TEST',
      accountNumberLast4: '6789',
    });
    expect(fake.confirmCalls).toEqual(['https://example.test/webhook']);
    fake.failNext('confirmWebhook');
    await expect(
      fake.confirmWebhook('https://example.test/webhook'),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    fake.failNext('getPaymentRecord');
    await expect(fake.getPaymentRecord(input.orderCode)).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    );
    await expect(fake.getPaymentRecord(999)).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    );
    expect((await fake.getPayment(input.orderCode, 20000)).effect).toBe(
      'CREDIT',
    );
    await fake.cancelPayment(input.orderCode, 'test');
    expect(fake.cancelCalls).toEqual([
      { orderCode: input.orderCode, reason: 'test' },
    ]);
    expect(
      (await fake.verifyWebhook(signPayosWebhook(buildPayosWebhookData())))
        .orderCode,
    ).toBe(input.orderCode);
    fake.failNext('getPayment');
    await expect(
      fake.getPayment(input.orderCode, 20000),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    expect((await fake.getPayment(input.orderCode, 20000)).effect).toBe(
      'CREDIT',
    );
  });
  it('never succeeds without credentials', async () => {
    const unavailable = new UnconfiguredPaymentProvider();
    await expect(unavailable.confirmWebhook('url')).rejects.toThrow(
      'payOS is not configured',
    );
    await expect(unavailable.getPaymentRecord(123)).rejects.toThrow(
      'payOS is not configured',
    );
    await expect(
      unavailable.getPayment(1234567890, 20000),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    await expect(unavailable.verifyWebhook({})).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    );
  });
});
