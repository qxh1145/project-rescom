import { buildPaymentLink } from '../../../../test/fixtures/payos-webhook.fixture';
import { mapPaymentLink, parsePayosDateTime } from './payos-mapping';

describe('payOS mapping', () => {
  it.each([
    ['PAID', 20000, 'CREDIT'],
    ['PAID', 21000, 'AMOUNT_MISMATCH'],
    ['PAID', 10000, 'AMOUNT_MISMATCH'],
    ['UNDERPAID', 10000, 'AMOUNT_MISMATCH'],
    ['PENDING', 0, 'NO_CHANGE'],
    ['PROCESSING', 0, 'NO_CHANGE'],
    ['CANCELLED', 0, 'CANCELLED'],
    ['FAILED', 0, 'CANCELLED'],
    ['EXPIRED', 0, 'EXPIRED'],
  ])('%s paid %i maps to %s', (status, amountPaid, effect) => {
    expect(
      mapPaymentLink(buildPaymentLink({ status, amountPaid }), 20000).effect,
    ).toBe(effect);
  });
  it('rejects unknown statuses', () =>
    expect(() =>
      mapPaymentLink(buildPaymentLink({ status: 'UNKNOWN' }), 20000),
    ).toThrow());
  it('parses Vietnam local times into UTC and rejects malformed dates', () => {
    expect(parsePayosDateTime('2026-10-15 23:30:00')?.toISOString()).toBe(
      '2026-10-15T16:30:00.000Z',
    );
    expect(parsePayosDateTime('2026-10-15 01:30:00')?.toISOString()).toBe(
      '2026-10-14T18:30:00.000Z',
    );
    expect(parsePayosDateTime('2026-10-15T23:30:00+07:00')?.toISOString()).toBe(
      '2026-10-15T16:30:00.000Z',
    );
    expect(parsePayosDateTime('2026-02-30 15:00:00')).toBeNull();
    expect(parsePayosDateTime('garbage')).toBeNull();
    expect(parsePayosDateTime('2026-02-30T10:00:00Z')).toBeNull();
    expect(parsePayosDateTime('2026-10-15T24:00:00+07:00')).toBeNull();
  });
  it('takes first non-null account fields independently and latest transaction details', () => {
    const first = {
      reference: 'first',
      transactionDateTime: '2026-10-15 01:30:00',
      counterAccountBankId: null,
      counterAccountBankName: 'First bank',
      counterAccountName: null,
      counterAccountNumber: '1',
    };
    const second = {
      reference: 'second',
      transactionDateTime: '2026-10-15 23:30:00',
      counterAccountBankId: 'bank',
      counterAccountBankName: 'Second bank',
      counterAccountName: 'Name',
      counterAccountNumber: '2',
    };
    expect(
      mapPaymentLink(buildPaymentLink({ transactions: [first, second] }), 20000)
        .facts,
    ).toEqual({
      amountPaidVnd: 20000,
      providerReference: 'second',
      paidAt: new Date('2026-10-15T16:30:00Z'),
      counterAccountBankId: 'bank',
      counterAccountBankName: 'First bank',
      counterAccountName: 'Name',
      counterAccountNumber: '1',
    });
  });
});
