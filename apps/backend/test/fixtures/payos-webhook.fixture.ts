import { payosDataSignature } from '../../src/modules/economy/infrastructure/payos-mapping';
export const PAYOS_TEST_CHECKSUM_KEY =
  'test-checksum-only-not-a-production-secret';
export function buildPayosWebhookData(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    orderCode: 1234567890,
    amount: 20000,
    description: 'RC4567890',
    accountNumber: '123456789',
    reference: 'FT123',
    transactionDateTime: '2026-10-15 23:30:00',
    currency: 'VND',
    paymentLinkId: 'link-1234567890',
    code: '00',
    desc: 'success',
    counterAccountBankId: '970436',
    counterAccountBankName: 'Vietcombank',
    counterAccountName: 'TEST USER',
    counterAccountNumber: '123456',
    ...overrides,
  };
}
export function signPayosWebhook(
  data: Record<string, unknown>,
  key = PAYOS_TEST_CHECKSUM_KEY,
) {
  return {
    code: '00',
    desc: 'success',
    success: true,
    data,
    signature: payosDataSignature(data, key),
  };
}
export function buildPaymentLink(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1234567890',
    orderCode: 1234567890,
    amount: 20000,
    amountPaid: 20000,
    amountRemaining: 0,
    status: 'PAID',
    createdAt: '2026-10-15T16:00:00Z',
    transactions: [
      {
        reference: 'FT123',
        amount: 20000,
        accountNumber: '123456789',
        description: 'RC4567890',
        transactionDateTime: '2026-10-15 23:30:00',
        virtualAccountName: null,
        virtualAccountNumber: null,
        counterAccountBankId: '970436',
        counterAccountBankName: 'Vietcombank',
        counterAccountName: 'TEST USER',
        counterAccountNumber: '123456',
      },
    ],
    cancellationReason: null,
    canceledAt: null,
    ...overrides,
  };
}
