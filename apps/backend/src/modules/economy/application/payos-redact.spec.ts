import { redactPayosPayload } from './payos-redact';

describe('payOS payload redaction', () => {
  it('masks a webhook envelope and keeps signature and other fields', () => {
    const input = {
      code: '00',
      signature: 'signed',
      data: {
        orderCode: 123,
        accountNumber: '12345678',
        counterAccountNumber: '99887766',
        counterAccountName: 'Payer',
        virtualAccountNumber: '55554444',
        virtualAccountName: 'Virtual',
      },
    };
    expect(redactPayosPayload(input)).toEqual({
      code: '00',
      signature: 'signed',
      data: {
        orderCode: 123,
        accountNumber: '****5678',
        counterAccountNumber: '****7766',
        counterAccountName: 'P***',
        virtualAccountNumber: '****4444',
        virtualAccountName: 'V***',
      },
    });
  });

  it('masks each transaction of a GET link with 2 transactions', () => {
    const input = {
      amountPaid: 10000,
      transactions: [
        {
          reference: 'a',
          counterAccountNumber: '11112222',
          accountName: 'Merchant',
        },
        {
          reference: 'b',
          counterAccountNumber: '33334444',
          accountName: 'Merchant',
        },
      ],
    };
    expect(redactPayosPayload(input)).toEqual({
      amountPaid: 10000,
      transactions: [
        {
          reference: 'a',
          counterAccountNumber: '****2222',
          accountName: 'M***',
        },
        {
          reference: 'b',
          counterAccountNumber: '****4444',
          accountName: 'M***',
        },
      ],
    });
  });

  it('keeps null counter fields null and turns empty values into null', () => {
    expect(
      redactPayosPayload({
        counterAccountNumber: null,
        counterAccountName: null,
        virtualAccountNumber: '',
        virtualAccountName: '',
      }),
    ).toEqual({
      counterAccountNumber: null,
      counterAccountName: null,
      virtualAccountNumber: null,
      virtualAccountName: null,
    });
  });

  it('fully masks numbers shorter than 4 characters', () => {
    expect(
      redactPayosPayload({ accountNumber: '12', counterAccountNumber: '123' }),
    ).toEqual({ accountNumber: '****', counterAccountNumber: '****' });
  });

  it('does not mutate the input', () => {
    const input = {
      data: { accountNumber: '12345678', accountName: 'Merchant' },
    };
    redactPayosPayload(input);
    expect(input).toEqual({
      data: { accountNumber: '12345678', accountName: 'Merchant' },
    });
  });
});
