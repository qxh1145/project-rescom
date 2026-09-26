import {
  POINT_VND_RATE,
  TOP_UP_MAX_POINTS,
  TOP_UP_MIN_POINTS,
  TOP_UP_REFERENCE_ALPHABET,
  TOP_UP_REFERENCE_CODE_LENGTH,
  TOP_UP_REFERENCE_PREFIX,
  adminTopUpRequestSchema,
  buildTopUpReference,
  buildVietQrPayload,
  crc16CcittFalse,
  createTopUpRequestSchema,
  listTopUpRequestsQuerySchema,
  pointsToVnd,
  rejectTopUpRequestSchema,
  topUpAdminAuditEventPayloadSchema,
  topUpReferenceSchema,
  topUpRequestSchema,
  topUpReviewResultSchema,
  topUpStatusSchema,
} from './top-up.schema';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const TOP_UP_ID = '33333333-3333-4333-8333-333333333333';
const JOURNAL_ID = '44444444-4444-4444-8444-444444444444';
const CORRELATION_ID = '55555555-5555-4555-8555-555555555555';

function parseEmvFields(payload: string): Map<string, string> {
  const fields = new Map<string, string>();
  let index = 0;
  while (index < payload.length) {
    const id = payload.slice(index, index + 2);
    const length = Number(payload.slice(index + 2, index + 4));
    fields.set(id, payload.slice(index + 4, index + 4 + length));
    index += 4 + length;
  }
  return fields;
}

describe('Top-up schemas (Story 6.6, FR-34/FR-35)', () => {
  describe('constants and conversion', () => {
    it('uses 1 point = 200 VND with a 100-point minimum (20,000 VND)', () => {
      expect(POINT_VND_RATE).toBe(200);
      expect(TOP_UP_MIN_POINTS).toBe(100);
      expect(pointsToVnd(TOP_UP_MIN_POINTS)).toBe(20_000);
      expect(pointsToVnd(TOP_UP_MAX_POINTS)).toBe(10_000_000);
    });

    it('rejects non-integer or negative point amounts in pointsToVnd', () => {
      expect(() => pointsToVnd(1.5)).toThrow();
      expect(() => pointsToVnd(-1)).toThrow();
    });

    it('keeps the status enum identical to the Prisma TopUpStatus enum', () => {
      expect(topUpStatusSchema.options).toEqual([
        'PENDING',
        'APPROVED',
        'REJECTED',
      ]);
    });
  });

  describe('createTopUpRequestSchema', () => {
    it('accepts the minimum and maximum amounts', () => {
      expect(createTopUpRequestSchema.parse({ amount: 100 })).toEqual({
        amount: 100,
      });
      expect(
        createTopUpRequestSchema.parse({ amount: TOP_UP_MAX_POINTS }).amount,
      ).toBe(TOP_UP_MAX_POINTS);
    });

    it('rejects amounts below the minimum, above the maximum, or fractional', () => {
      expect(createTopUpRequestSchema.safeParse({ amount: 99 }).success).toBe(
        false,
      );
      expect(
        createTopUpRequestSchema.safeParse({ amount: TOP_UP_MAX_POINTS + 1 })
          .success,
      ).toBe(false);
      expect(
        createTopUpRequestSchema.safeParse({ amount: 150.5 }).success,
      ).toBe(false);
      expect(
        createTopUpRequestSchema.safeParse({ amount: '100' }).success,
      ).toBe(false);
    });

    it('rejects unknown fields such as a client-chosen user or status', () => {
      expect(
        createTopUpRequestSchema.safeParse({ amount: 100, userId: USER_ID })
          .success,
      ).toBe(false);
    });
  });

  describe('transfer reference', () => {
    it('builds an unbiased RESCOM-prefixed reference from random bytes', () => {
      const bytes = Uint8Array.from([0, 1, 2, 31, 32, 63, 255, 128]);
      const reference = buildTopUpReference(bytes);
      expect(reference.startsWith(TOP_UP_REFERENCE_PREFIX)).toBe(true);
      expect(reference).toHaveLength(
        TOP_UP_REFERENCE_PREFIX.length + TOP_UP_REFERENCE_CODE_LENGTH,
      );
      expect(reference).toBe(
        `RESCOM${TOP_UP_REFERENCE_ALPHABET[0]}${TOP_UP_REFERENCE_ALPHABET[1]}${TOP_UP_REFERENCE_ALPHABET[2]}${TOP_UP_REFERENCE_ALPHABET[31]}${TOP_UP_REFERENCE_ALPHABET[0]}${TOP_UP_REFERENCE_ALPHABET[31]}${TOP_UP_REFERENCE_ALPHABET[31]}${TOP_UP_REFERENCE_ALPHABET[0]}`,
      );
      expect(topUpReferenceSchema.safeParse(reference).success).toBe(true);
    });

    it('requires enough random bytes', () => {
      expect(() => buildTopUpReference(Uint8Array.from([1, 2, 3]))).toThrow();
    });

    it('uses an alphabet without ambiguous characters', () => {
      expect(TOP_UP_REFERENCE_ALPHABET).toHaveLength(32);
      expect(TOP_UP_REFERENCE_ALPHABET).not.toMatch(/[01IO]/);
      expect(topUpReferenceSchema.safeParse('RESCOMABCDEFG0').success).toBe(
        false,
      );
      expect(topUpReferenceSchema.safeParse('rescomabcdefgh').success).toBe(
        false,
      );
    });
  });

  describe('VietQR payload', () => {
    it('computes CRC-16/CCITT-FALSE with the standard check value', () => {
      expect(crc16CcittFalse('123456789')).toBe('29B1');
    });

    it('builds an EMVCo VietQR transfer payload with a valid trailing CRC', () => {
      const payload = buildVietQrPayload({
        bankBin: '970436',
        accountNumber: '0123456789',
        amountVnd: 20_000,
        transferContent: 'RESCOMABCDEFGH',
      });

      const fields = parseEmvFields(payload);
      expect(fields.get('00')).toBe('01');
      expect(fields.get('01')).toBe('12');
      expect(fields.get('53')).toBe('704');
      expect(fields.get('54')).toBe('20000');
      expect(fields.get('58')).toBe('VN');

      const merchant = parseEmvFields(fields.get('38') ?? '');
      expect(merchant.get('00')).toBe('A000000727');
      expect(merchant.get('02')).toBe('QRIBFTTA');
      const beneficiary = parseEmvFields(merchant.get('01') ?? '');
      expect(beneficiary.get('00')).toBe('970436');
      expect(beneficiary.get('01')).toBe('0123456789');

      const additional = parseEmvFields(fields.get('62') ?? '');
      expect(additional.get('08')).toBe('RESCOMABCDEFGH');

      expect(payload.slice(-8, -4)).toBe('6304');
      expect(payload.slice(-4)).toBe(crc16CcittFalse(payload.slice(0, -4)));
    });

    it('rejects invalid bank identifiers or non-ASCII transfer content', () => {
      expect(() =>
        buildVietQrPayload({
          bankBin: '97043',
          accountNumber: '0123456789',
          amountVnd: 20_000,
          transferContent: 'RESCOMABCDEFGH',
        }),
      ).toThrow();
      expect(() =>
        buildVietQrPayload({
          bankBin: '970436',
          accountNumber: '0123456789',
          amountVnd: 20_000,
          transferContent: 'Nạp điểm',
        }),
      ).toThrow();
    });
  });

  describe('DTOs', () => {
    const paymentInstructions = {
      bankName: 'Vietcombank',
      bankBin: '970436',
      accountNumber: '0123456789',
      accountName: 'RESCOM DEMO',
      amountVnd: 20_000,
      transferContent: 'RESCOMABCDEFGH',
      qrPayload: buildVietQrPayload({
        bankBin: '970436',
        accountNumber: '0123456789',
        amountVnd: 20_000,
        transferContent: 'RESCOMABCDEFGH',
      }),
    };

    const ownerDto = {
      id: TOP_UP_ID,
      amount: 100,
      amountVnd: 20_000,
      status: 'PENDING' as const,
      transferReference: 'RESCOMABCDEFGH',
      rejectionReason: null,
      createdAt: '2026-09-26T10:00:00.000Z',
      reviewedAt: null,
      paymentInstructions,
    };

    it('accepts a pending owner DTO with payment instructions', () => {
      expect(topUpRequestSchema.safeParse(ownerDto).success).toBe(true);
    });

    it('accepts an admin DTO and a review result', () => {
      const adminDto = {
        ...ownerDto,
        status: 'APPROVED' as const,
        reviewedAt: '2026-09-26T11:00:00.000Z',
        paymentInstructions: null,
        userId: USER_ID,
        userEmail: 'student@fpt.edu.vn',
        adminId: ADMIN_ID,
        journalId: JOURNAL_ID,
        correlationId: CORRELATION_ID,
      };
      expect(adminTopUpRequestSchema.safeParse(adminDto).success).toBe(true);
      expect(
        topUpReviewResultSchema.safeParse({
          topUp: adminDto,
          journalId: JOURNAL_ID,
          replayed: false,
        }).success,
      ).toBe(true);
    });

    it('parses list queries from query-string values with defaults', () => {
      expect(listTopUpRequestsQuerySchema.parse({})).toEqual({
        limit: 20,
        offset: 0,
      });
      expect(
        listTopUpRequestsQuerySchema.parse({
          limit: '5',
          offset: '10',
          status: 'PENDING',
        }),
      ).toEqual({ limit: 5, offset: 10, status: 'PENDING' });
      expect(
        listTopUpRequestsQuerySchema.safeParse({ limit: '500' }).success,
      ).toBe(false);
      expect(
        listTopUpRequestsQuerySchema.safeParse({ status: 'UNKNOWN' }).success,
      ).toBe(false);
    });

    it('requires a meaningful, trimmed rejection reason', () => {
      expect(
        rejectTopUpRequestSchema.parse({ reason: '  Không tìm thấy giao dịch  ' }),
      ).toEqual({ reason: 'Không tìm thấy giao dịch' });
      expect(rejectTopUpRequestSchema.safeParse({ reason: ' no ' }).success).toBe(
        false,
      );
      expect(rejectTopUpRequestSchema.safeParse({}).success).toBe(false);
      expect(
        rejectTopUpRequestSchema.safeParse({ reason: 'x'.repeat(501) }).success,
      ).toBe(false);
    });
  });

  describe('admin-audit event payload', () => {
    it('accepts the approval audit contract', () => {
      expect(
        topUpAdminAuditEventPayloadSchema.safeParse({
          schemaVersion: 1,
          auditCategory: 'MODERATION_ADMIN_ACTION',
          action: 'TOPUP_APPROVED',
          topUpId: TOP_UP_ID,
          userId: USER_ID,
          adminId: ADMIN_ID,
          amount: 100,
          amountVnd: 20_000,
          transferReference: 'RESCOMABCDEFGH',
          journalId: JOURNAL_ID,
          ledgerIdempotencyKey: `topup-approval:${TOP_UP_ID}`,
          rejectionReason: null,
          correlationId: CORRELATION_ID,
          occurredAt: '2026-09-26T11:00:00.000Z',
        }).success,
      ).toBe(true);
    });

    it('rejects unknown audit actions', () => {
      expect(
        topUpAdminAuditEventPayloadSchema.safeParse({
          schemaVersion: 1,
          auditCategory: 'MODERATION_ADMIN_ACTION',
          action: 'TOPUP_REFUNDED',
          topUpId: TOP_UP_ID,
          userId: USER_ID,
          adminId: ADMIN_ID,
          amount: 100,
          amountVnd: 20_000,
          transferReference: 'RESCOMABCDEFGH',
          journalId: null,
          ledgerIdempotencyKey: null,
          rejectionReason: null,
          correlationId: CORRELATION_ID,
          occurredAt: '2026-09-26T11:00:00.000Z',
        }).success,
      ).toBe(false);
    });
  });
});
