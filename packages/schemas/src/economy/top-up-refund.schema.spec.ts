import {
  canAccountClassOverdraft,
  NON_OVERDRAFTABLE_ACCOUNT_CLASSES,
} from './ledger-account.schema';
import {
  submitTopUpRefundSchema,
  topUpRefundAdminNoticePayloadSchema,
  topUpRefundChangedPayloadSchema,
  topUpRefundDeadline,
  topUpRefundHoldKey,
  topUpRefundReasonSchema,
  topUpRefundResolveKey,
  topUpRefundResultSchema,
  topUpRefundStatusSchema,
  topUpRefundWithdrawKey,
  TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE,
  TOP_UP_REFUND_CHANGED_EVENT_TYPE,
  TOP_UP_REFUND_HOLD_KEY_PREFIX,
  TOP_UP_REFUND_NOTE_MAX,
  TOP_UP_REFUND_RESOLVE_KEY_PREFIX,
  TOP_UP_REFUND_WINDOW_MS,
  TOP_UP_REFUND_WITHDRAW_KEY_PREFIX,
  userTopUpRefundDestinationSchema,
  userTopUpRefundDestinationViewSchema,
  userTopUpRefundRequestSchema,
} from './top-up-refund.schema';
import { topUpCreditKey, topUpMismatchKey } from './payos-top-up.schema';

describe('Top-Up Refund Contracts (Story 13.10)', () => {
  const reqId = '11111111-1111-4111-8111-111111111111';
  const topUpId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const nowIso = '2026-10-16T12:00:00.000Z';

  describe('deadline helper', () => {
    it('returns paidAt + 24 hours exact instant', () => {
      const paidAt = new Date('2026-10-16T10:00:00.000Z');
      const deadline = topUpRefundDeadline(paidAt);
      expect(deadline.getTime() - paidAt.getTime()).toBe(TOP_UP_REFUND_WINDOW_MS);
      expect(deadline.toISOString()).toBe('2026-10-17T10:00:00.000Z');
    });
  });

  describe('submitTopUpRefundSchema', () => {
    it('accepts valid reason and note between 1 and 300 chars after trim', () => {
      const parsed = submitTopUpRefundSchema.parse({
        reason: 'WRONG_AMOUNT',
        note: '  I paid too much  ',
      });
      expect(parsed).toEqual({
        reason: 'WRONG_AMOUNT',
        note: 'I paid too much',
      });
    });

    it('rejects empty, whitespace-only, or over-300-char notes', () => {
      expect(
        submitTopUpRefundSchema.safeParse({
          reason: 'WRONG_AMOUNT',
          note: '',
        }).success,
      ).toBe(false);

      expect(
        submitTopUpRefundSchema.safeParse({
          reason: 'WRONG_AMOUNT',
          note: '   ',
        }).success,
      ).toBe(false);

      const exactly300 = 'a'.repeat(300);
      expect(
        submitTopUpRefundSchema.safeParse({
          reason: 'WRONG_AMOUNT',
          note: exactly300,
        }).success,
      ).toBe(true);

      const over300 = 'a'.repeat(301);
      expect(
        submitTopUpRefundSchema.safeParse({
          reason: 'WRONG_AMOUNT',
          note: over300,
        }).success,
      ).toBe(false);
    });

    it('rejects unknown reasons', () => {
      expect(
        submitTopUpRefundSchema.safeParse({
          reason: 'NOT_A_REASON',
          note: 'Valid note',
        }).success,
      ).toBe(false);
    });

    it('is strict: rejects extra keys', () => {
      expect(
        submitTopUpRefundSchema.safeParse({
          reason: 'OTHER',
          note: 'Valid',
          extra: true,
        }).success,
      ).toBe(false);
    });
  });

  describe('userTopUpRefundRequestSchema & security', () => {
    const validRequest = {
      id: reqId,
      status: 'REQUESTED' as const,
      eligibility: 'ELIGIBLE' as const,
      ineligibleReason: null,
      reason: 'WRONG_AMOUNT' as const,
      points: 50,
      amountVnd: 10000,
      destination: {
        bankId: '970422',
        bankName: 'MBBank',
        holderName: 'NGUYEN VAN A',
        last4: '1234',
        verified: true,
        accountNumber: '0123456789',
      },
      submittedAt: nowIso,
      withdrawnAt: null,
    };

    it('parses valid user refund request summary with 13.10 shape (no resolution fields)', () => {
      expect(userTopUpRefundRequestSchema.parse(validRequest)).toEqual(validRequest);
    });

    it('parses user refund request summary with optional resolution fields (Story 13.11)', () => {
      const withResolution = {
        ...validRequest,
        status: 'REFUNDED' as const,
        resolvedAt: nowIso,
        rejectionReason: null,
        bankTransferReference: 'FT123456789',
        bankTransferredAt: nowIso,
      };
      expect(userTopUpRefundRequestSchema.parse(withResolution)).toEqual(withResolution);
    });

    it('validates userTopUpRefundDestinationViewSchema with optional accountNumber (string or null)', () => {
      const validWithAcc = {
        bankId: '970422',
        bankName: 'MBBank',
        holderName: 'NGUYEN VAN A',
        last4: '1234',
        verified: true,
        accountNumber: '0123456789',
      };
      expect(userTopUpRefundDestinationViewSchema.parse(validWithAcc)).toEqual(validWithAcc);

      const validWithNullAcc = {
        ...validWithAcc,
        accountNumber: null,
      };
      expect(userTopUpRefundDestinationViewSchema.parse(validWithNullAcc)).toEqual(validWithNullAcc);

      // Optional for FE-before-BE rollout compatibility (13.11 review).
      const { accountNumber: _omit, ...withoutAcc } = validWithAcc;
      expect(userTopUpRefundDestinationViewSchema.safeParse(withoutAcc).success).toBe(true);
      expect(
        userTopUpRefundDestinationViewSchema.safeParse({
          ...validWithAcc,
          accountNumber: 123,
        }).success,
      ).toBe(false);
    });

    it('never accepts unknown properties (strict)', () => {
      expect(
        userTopUpRefundRequestSchema.safeParse({
          ...validRequest,
          counterAccountNumber: '0123456789',
        }).success,
      ).toBe(false);

      expect(
        userTopUpRefundRequestSchema.safeParse({
          ...validRequest,
          extraUnknownKey: true,
        }).success,
      ).toBe(false);
    });

    it('validates topUpRefundResultSchema with replayed flag', () => {
      expect(
        topUpRefundResultSchema.parse({
          request: validRequest,
          replayed: false,
        }),
      ).toEqual({
        request: validRequest,
        replayed: false,
      });
    });
  });

  describe('key distinctness', () => {
    it('generates distinct keys that do not start with credit or mismatch prefixes', () => {
      const holdKey = topUpRefundHoldKey(reqId);
      const withdrawKey = topUpRefundWithdrawKey(reqId);
      const resolveKey = topUpRefundResolveKey(reqId);

      expect(holdKey.startsWith(TOP_UP_REFUND_HOLD_KEY_PREFIX)).toBe(true);
      expect(withdrawKey.startsWith(TOP_UP_REFUND_WITHDRAW_KEY_PREFIX)).toBe(true);
      expect(resolveKey.startsWith(TOP_UP_REFUND_RESOLVE_KEY_PREFIX)).toBe(true);

      const sampleCreditKey = topUpCreditKey(reqId);
      const sampleMismatchKey = topUpMismatchKey(reqId);

      for (const k of [holdKey, withdrawKey, resolveKey]) {
        expect(k.startsWith(sampleCreditKey)).toBe(false);
        expect(k.startsWith(sampleMismatchKey)).toBe(false);
        expect(k.startsWith('topup-credit:')).toBe(false);
        expect(k.startsWith('topup-mismatch:')).toBe(false);
      }
    });
  });

  describe('REFUND_HOLD account policy', () => {
    it('is non-overdraftable', () => {
      expect(NON_OVERDRAFTABLE_ACCOUNT_CLASSES).toContain('REFUND_HOLD');
      expect(canAccountClassOverdraft('REFUND_HOLD')).toBe(false);
    });
  });

  describe('Outbox event schemas', () => {
    it('validates topUpRefundChangedPayloadSchema', () => {
      const payload = {
        schemaVersion: 1 as const,
        requestId: reqId,
        topUpId,
        userId,
        orderCode: 1000000001,
        status: 'REQUESTED' as const,
        eligibility: 'ELIGIBLE' as const,
        ineligibleReason: null,
        points: 50,
        amountVnd: 10000,
        occurredAt: nowIso,
      };

      expect(topUpRefundChangedPayloadSchema.parse(payload)).toEqual(payload);
      expect(TOP_UP_REFUND_CHANGED_EVENT_TYPE).toBe('ECONOMY_TOPUP_REFUND_CHANGED');
    });

    it('validates topUpRefundAdminNoticePayloadSchema with masked destination only', () => {
      const payload = {
        schemaVersion: 1 as const,
        requestId: reqId,
        topUpId,
        userId,
        orderCode: 1000000001,
        status: 'REQUESTED' as const,
        eligibility: 'ELIGIBLE' as const,
        ineligibleReason: null,
        points: 50,
        amountVnd: 10000,
        occurredAt: nowIso,
        userEmail: 'user@example.com',
        reason: 'WRONG_AMOUNT' as const,
        note: 'Customer mistyped amount',
        destination: {
          bankId: '970422',
          bankName: 'MBBank',
          holderName: 'NGUYEN VAN A',
          last4: '1234',
          verified: true,
        },
      };

      expect(topUpRefundAdminNoticePayloadSchema.parse(payload)).toEqual(payload);
      expect(TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE).toBe('ECONOMY_TOPUP_REFUND_ADMIN_NOTICE');

      // Reject full account number in destination
      expect(
        topUpRefundAdminNoticePayloadSchema.safeParse({
          ...payload,
          destination: {
            ...payload.destination,
            accountNumber: '1234567890',
          },
        }).success,
      ).toBe(false);
    });
  });
});
