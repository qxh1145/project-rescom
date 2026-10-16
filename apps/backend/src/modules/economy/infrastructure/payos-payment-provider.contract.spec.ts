import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APIError,
  ConnectionTimeoutError,
  PayOS,
  WebhookError,
} from '@payos/node';
import { PAYOS_TEST_CHECKSUM_KEY } from '../../../../test/fixtures/payos-webhook.fixture';
import {
  PaymentProviderSignatureError,
  PaymentProviderUnavailableError,
} from '../application/ports/payment-provider.port';
import { mapPaymentLink } from './payos-mapping';
import { PayosPaymentProvider } from './payos-payment-provider.adapter';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../test/fixtures/payos-recorded',
        `${name}.json`,
      ),
      'utf8',
    ),
  );
describe('payOS offline contract', () => {
  const client = new PayOS({
    checksumKey: PAYOS_TEST_CHECKSUM_KEY,
    clientId: 'test-client',
    apiKey: 'test-key',
    maxRetries: 0,
    logLevel: 'off',
    logger: null,
  });
  const provider = new PayosPaymentProvider(
    PAYOS_TEST_CHECKSUM_KEY,
    'test-client',
    'test-key',
    client,
  );
  it('preserves payOS webhook validation reason without leaking credentials', async () => {
    const confirm = jest
      .fn()
      .mockRejectedValue(
        new WebhookError('Webhook validation failed: unreachable'),
      );
    const mocked = new PayosPaymentProvider(
      PAYOS_TEST_CHECKSUM_KEY,
      'test-client',
      'test-secret-api-key',
      { webhooks: { confirm } } as never,
    );
    try {
      await mocked.confirmWebhook('https://example.test/webhook');
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentProviderUnavailableError);
      expect((error as Error).message).toBe(
        'Webhook validation failed: unreachable',
      );
      expect(JSON.stringify(error)).not.toContain('test-secret-api-key');
      expect(JSON.stringify(error)).not.toContain(PAYOS_TEST_CHECKSUM_KEY);
    }
  });
  it('maps a non-WebhookError confirm failure through call()', async () => {
    const confirm = jest
      .fn()
      .mockRejectedValueOnce(
        APIError.generateError(
          200,
          { code: '231', desc: 'Rejected' },
          undefined,
          new Headers(),
        ),
      )
      .mockRejectedValueOnce(new Error('socket hang up'));
    const mocked = new PayosPaymentProvider(
      PAYOS_TEST_CHECKSUM_KEY,
      'test-client',
      'test-key',
      { webhooks: { confirm } } as never,
    );
    await expect(
      mocked.confirmWebhook('https://example.test/webhook'),
    ).rejects.toMatchObject({
      name: PaymentProviderUnavailableError.name,
      providerCode: '231',
      providerDesc: 'Rejected',
    });
    await expect(
      mocked.confirmWebhook('https://example.test/webhook'),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
  });
  it('constructs offline SDK with zero retries and disabled logs', () => {
    const constructed = (
      new PayosPaymentProvider(
        PAYOS_TEST_CHECKSUM_KEY,
        'test-client',
        'test-key',
      ) as unknown as { client: PayOS }
    ).client;
    expect(constructed.maxRetries).toBe(0);
    expect(constructed.logLevel).toBe('off');
    expect(constructed.timeout).toBe(10_000);
    expect(constructed.baseURL).toBe('https://api-merchant.payos.vn');
  });
  it('converts SDK API and timeout errors without exposing credentials', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(
        APIError.generateError(
          200,
          { code: '231', desc: 'Rejected' },
          undefined,
          new Headers(),
        ),
      )
      .mockRejectedValueOnce(new ConnectionTimeoutError());
    const mocked = new PayosPaymentProvider(
      PAYOS_TEST_CHECKSUM_KEY,
      'test-client',
      'test-secret-api-key',
      { paymentRequests: { create } } as never,
    );
    const input = {
      orderCode: 1234567890,
      amountVnd: 20000,
      returnUrl: 'return',
      cancelUrl: 'cancel',
      expiresAt: new Date(),
    };
    try {
      await mocked.createPayment(input);
      throw new Error('Expected API failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentProviderUnavailableError);
      expect((error as PaymentProviderUnavailableError).providerCode).toBe(
        '231',
      );
      expect(JSON.stringify(error)).not.toContain('test-secret-api-key');
      expect(JSON.stringify(error)).not.toContain(PAYOS_TEST_CHECKSUM_KEY);
    }
    await expect(mocked.createPayment(input)).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    );
  });
  const nullCounter = {
    counterAccountBankId: null,
    counterAccountBankName: null,
    counterAccountName: null,
    counterAccountNumber: null,
  };
  // Story 13.6 production capture: webhook sends bank name "", GET sends null;
  // both map to null. Webhook time has no zone (+07:00), GET is ISO with zone.
  const liveFacts = {
    amountPaidVnd: 10000,
    providerReference: 'FT00000000000001',
    paidAt: new Date('2026-10-16T13:02:00Z'),
    counterAccountBankId: '970422',
    counterAccountBankName: null,
    counterAccountName: null,
    counterAccountNumber: '****0614',
  };
  it.each([
    ['webhook-paid', 1234567890, {}],
    ['webhook-paid-null-counter-account', 1234567890, nullCounter],
    ['webhook-paid-live', 1000000001, liveFacts],
  ])(
    'validates recorded %s with SDK and provider',
    async (name, orderCode, facts) => {
      const { _source, ...webhook } = fixture(name);
      await expect(client.webhooks.verify(webhook)).resolves.toMatchObject({
        orderCode,
      });
      const verified = await provider.verifyWebhook(webhook);
      expect(verified.orderCode).toBe(orderCode);
      expect(verified.facts).toMatchObject(facts);
      const tampered = { ...webhook, data: { ...webhook.data, amount: 1 } };
      await expect(client.webhooks.verify(tampered)).rejects.toThrow();
      await expect(provider.verifyWebhook(tampered)).rejects.toBeInstanceOf(
        PaymentProviderSignatureError,
      );
    },
  );
  it.each([
    ['payment-link-paid', 20000, 'CREDIT', nullCounter],
    ['payment-link-underpaid', 20000, 'AMOUNT_MISMATCH', nullCounter],
    ['payment-link-cancelled', 20000, 'CANCELLED', nullCounter],
    ['payment-link-paid-live', 10000, 'CREDIT', liveFacts],
  ])('maps recorded %s to %s', (name, expectedAmountVnd, effect, facts) => {
    const { _source, ...link } = fixture(name);
    expect(mapPaymentLink(link, expectedAmountVnd)).toMatchObject({
      effect,
      facts,
    });
  });
});
