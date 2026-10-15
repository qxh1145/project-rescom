import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PaymentProviderSignatureError,
  PaymentProviderUnavailableError,
  type ProviderPaymentFacts,
  type ProviderPaymentSnapshot,
  type VerifiedPaymentWebhook,
} from '../application/ports/payment-provider.port';

export interface PayosTransactionLike {
  reference?: string | null;
  transactionDateTime?: string | null;
  counterAccountBankId?: string | null;
  counterAccountBankName?: string | null;
  counterAccountName?: string | null;
  counterAccountNumber?: string | null;
}
export interface PaymentLinkLike {
  orderCode: number;
  status: string;
  amountPaid: number;
  transactions: PayosTransactionLike[];
}

export function payosDataSignature(
  data: Record<string, unknown>,
  checksumKey: string,
): string {
  const sorted = (object: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  const query = Object.entries(sorted(data))
    .filter(([, value]) => value !== undefined)
    .map(([key, raw]) => {
      const value = Array.isArray(raw)
        ? JSON.stringify(
            raw.map((entry: Record<string, unknown>) => sorted(entry)),
          )
        : raw;
      return `${key}=${value === null || value === undefined || value === 'null' || value === 'undefined' ? '' : String(value)}`;
    })
    .join('&');
  return createHmac('sha256', checksumKey).update(query).digest('hex');
}

export function parsePayosDateTime(
  value: string | null | undefined,
): Date | null {
  if (!value) return null;
  const local = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)$/.exec(value);
  const iso =
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value);
  if (!local && !iso) return null;
  const date = new Date(local ? `${local[1]}T${local[2]}+07:00` : value);
  if (Number.isNaN(date.getTime())) return null;
  if (
    local &&
    new Date(date.getTime() + 7 * 3600_000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ') !== value
  )
    return null;
  // ISO input: Date rolls impossible calendar values over (02-30 -> 03-02, 24:00 -> next day).
  if (
    !local &&
    new Date(`${value.slice(0, 19)}Z`).toISOString().slice(0, 19) !==
      value.slice(0, 19)
  )
    return null;
  return date;
}

const counterFields = [
  'counterAccountBankId',
  'counterAccountBankName',
  'counterAccountName',
  'counterAccountNumber',
] as const;
export function paymentFacts(
  amountPaidVnd: number,
  transactions: PayosTransactionLike[],
): ProviderPaymentFacts {
  const latest = transactions[transactions.length - 1];
  return {
    amountPaidVnd,
    providerReference: latest?.reference ?? null,
    paidAt: parsePayosDateTime(latest?.transactionDateTime),
    ...Object.fromEntries(
      counterFields.map((field) => [
        field,
        transactions.find((transaction) => transaction[field] != null)?.[
          field
        ] ?? null,
      ]),
    ),
  } as ProviderPaymentFacts;
}
export function mapPaymentLink(
  link: PaymentLinkLike,
  expectedAmountVnd: number,
): ProviderPaymentSnapshot {
  const effect =
    link.status === 'PAID'
      ? link.amountPaid === expectedAmountVnd
        ? 'CREDIT'
        : 'AMOUNT_MISMATCH'
      : link.status === 'UNDERPAID'
        ? 'AMOUNT_MISMATCH'
        : link.status === 'PENDING' || link.status === 'PROCESSING'
          ? 'NO_CHANGE'
          : link.status === 'CANCELLED' || link.status === 'FAILED'
            ? 'CANCELLED'
            : link.status === 'EXPIRED'
              ? 'EXPIRED'
              : null;
  if (!effect)
    throw new PaymentProviderUnavailableError(
      'Unknown payment provider status',
    );
  return {
    orderCode: link.orderCode,
    providerStatus: link.status,
    effect,
    facts: paymentFacts(link.amountPaid, link.transactions ?? []),
  };
}

export function verifyPayosWebhook(
  body: unknown,
  checksumKey: string,
): VerifiedPaymentWebhook {
  if (!body || typeof body !== 'object')
    throw new PaymentProviderSignatureError();
  const envelope = body as Record<string, unknown>;
  if (
    typeof envelope.signature !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(envelope.signature) ||
    !envelope.data ||
    typeof envelope.data !== 'object' ||
    Array.isArray(envelope.data)
  )
    throw new PaymentProviderSignatureError();
  const data = envelope.data as Record<string, unknown>;
  if (
    typeof data.orderCode !== 'number' ||
    !Number.isSafeInteger(data.orderCode) ||
    typeof data.amount !== 'number' ||
    !Number.isSafeInteger(data.amount) ||
    data.amount < 0 ||
    typeof data.paymentLinkId !== 'string' ||
    typeof data.code !== 'string' ||
    typeof envelope.code !== 'string'
  )
    throw new PaymentProviderSignatureError();
  let expected: Buffer;
  try {
    expected = Buffer.from(payosDataSignature(data, checksumKey), 'hex');
  } catch {
    throw new PaymentProviderSignatureError();
  }
  const supplied = Buffer.from(envelope.signature, 'hex');
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    throw new PaymentProviderSignatureError();
  return {
    orderCode: data.orderCode,
    paymentLinkId: data.paymentLinkId,
    code: envelope.code,
    dataCode: data.code,
    amountVnd: data.amount,
    facts: paymentFacts(data.amount, [data]),
  };
}
