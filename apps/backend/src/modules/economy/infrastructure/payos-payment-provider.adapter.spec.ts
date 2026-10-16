import {
  buildPaymentLink,
  buildPayosWebhookData,
  signPayosWebhook,
} from '../../../../test/fixtures/payos-webhook.fixture';
import {
  PaymentProviderSignatureError,
  PaymentProviderUnavailableError,
} from '../application/ports/payment-provider.port';
import type { EnvService } from '../../../common/config/env.service';
import {
  createPaymentProvider,
  PayosPaymentProvider,
} from './payos-payment-provider.adapter';
import { UnconfiguredPaymentProvider } from './unconfigured-payment-provider';

const apiKey = 'test-api-key-secret';
const checksumKey = 'test-checksum-key-secret';
function setup() {
  const create = jest.fn().mockResolvedValue({
    paymentLinkId: 'link',
    checkoutUrl: 'https://pay.payos.vn/link',
  });
  const get = jest.fn();
  const cancel = jest.fn().mockResolvedValue({});
  const confirm = jest.fn().mockResolvedValue({
    webhookUrl: 'https://example.test/webhook',
    accountName: 'Merchant',
    accountNumber: '12345678',
  });
  const client = {
    paymentRequests: { create, get, cancel },
    webhooks: { confirm },
  } as never;
  return {
    provider: new PayosPaymentProvider(
      checksumKey,
      'test-client',
      apiKey,
      client,
    ),
    create,
    get,
    cancel,
    confirm,
  };
}
describe('payOS provider', () => {
  it('confirms webhook without exposing full account number', async () => {
    const { provider, confirm } = setup();
    await expect(
      provider.confirmWebhook('https://example.test/webhook'),
    ).resolves.toEqual({
      webhookUrl: 'https://example.test/webhook',
      accountName: 'Merchant',
      accountNumberLast4: '5678',
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('https://example.test/webhook');
  });
  it('returns raw GET response', async () => {
    const { provider, get } = setup();
    const raw = buildPaymentLink();
    get.mockResolvedValueOnce(raw);
    await expect(provider.getPaymentRecord(1234567890)).resolves.toBe(raw);
    expect(get).toHaveBeenCalledWith(1234567890);
  });
  it.each([
    [1000000000, 'RC0000000'],
    [1234567890, 'RC4567890'],
  ])(
    'creates order %i with nine-character description %s and zero retries',
    async (orderCode, description) => {
      const { provider, create } = setup();
      await expect(
        provider.createPayment({
          orderCode,
          amountVnd: 20000,
          returnUrl: 'https://example.test/return',
          cancelUrl: 'https://example.test/cancel',
          expiresAt: new Date('2026-10-15T16:05:00Z'),
        }),
      ).resolves.toEqual({
        paymentLinkId: 'link',
        checkoutUrl: 'https://pay.payos.vn/link',
      });
      expect(create).toHaveBeenCalledWith(
        {
          orderCode,
          amount: 20000,
          description,
          returnUrl: 'https://example.test/return',
          cancelUrl: 'https://example.test/cancel',
          expiredAt: 1792080300,
        },
        { maxRetries: 0 },
      );
    },
  );
  it('maps provider errors without leaking secrets', async () => {
    const { provider, create } = setup();
    create.mockRejectedValueOnce(new Error('provider error'));
    try {
      await provider.createPayment({
        orderCode: 1234567890,
        amountVnd: 20000,
        returnUrl: 'url',
        cancelUrl: 'url',
        expiresAt: new Date(),
      });
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentProviderUnavailableError);
      expect(
        (error as PaymentProviderUnavailableError).providerCode,
      ).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain(apiKey);
      expect(JSON.stringify(error)).not.toContain(checksumKey);
    }
    create.mockRejectedValueOnce(new Error('network timeout'));
    await expect(
      provider.createPayment({
        orderCode: 1234567890,
        amountVnd: 20000,
        returnUrl: 'url',
        cancelUrl: 'url',
        expiresAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
  });
  it('accepts signed webhook; rejects tamper, wrong key, missing signature and invalid body', async () => {
    const { provider } = setup();
    const webhook = signPayosWebhook(buildPayosWebhookData(), checksumKey);
    await expect(provider.verifyWebhook(webhook)).resolves.toMatchObject({
      orderCode: 1234567890,
      amountVnd: 20000,
    });
    for (const invalid of [
      { ...webhook, data: { ...webhook.data, amount: 1 } },
      signPayosWebhook(webhook.data, 'wrong-key'),
      { ...webhook, signature: undefined },
      null,
    ]) {
      await expect(provider.verifyWebhook(invalid)).rejects.toBeInstanceOf(
        PaymentProviderSignatureError,
      );
    }
  });
  it('rejects a signed-shape webhook whose array data cannot be canonicalised', async () => {
    const { provider } = setup();
    const webhook = signPayosWebhook(buildPayosWebhookData(), checksumKey);
    await expect(
      provider.verifyWebhook({
        ...webhook,
        data: { ...webhook.data, extra: [null] },
      }),
    ).rejects.toBeInstanceOf(PaymentProviderSignatureError);
  });
  it('gets a payment by numeric orderCode and maps it', async () => {
    const { provider, get } = setup();
    get.mockResolvedValueOnce(buildPaymentLink());
    await expect(provider.getPayment(1234567890, 20000)).resolves.toMatchObject(
      { orderCode: 1234567890, providerStatus: 'PAID', effect: 'CREDIT' },
    );
    expect(get).toHaveBeenCalledWith(1234567890);
    get.mockRejectedValueOnce(new Error('down'));
    await expect(provider.getPayment(1234567890, 20000)).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    );
  });
  it('cancels a payment with reason and maps failures', async () => {
    const { provider, cancel } = setup();
    await expect(
      provider.cancelPayment(1234567890, 'user'),
    ).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledWith(1234567890, 'user');
    cancel.mockRejectedValueOnce(new Error('down'));
    await expect(provider.cancelPayment(1234567890)).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    );
  });
  it('binds payOS only when credentials are configured', () => {
    expect(
      createPaymentProvider({
        payosCredentials: { clientId: 'c', apiKey: 'a', checksumKey: 'k' },
      } as EnvService),
    ).toBeInstanceOf(PayosPaymentProvider);
    expect(
      createPaymentProvider({ payosCredentials: null } as EnvService),
    ).toBeInstanceOf(UnconfiguredPaymentProvider);
  });
});
