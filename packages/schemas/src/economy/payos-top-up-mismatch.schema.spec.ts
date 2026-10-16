import {
  TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX, topUpMismatchKey, topUpMismatchNoticeKey,
  payosTransferContent, resolveTopUpMismatchSchema, resolveTopUpMismatchResultSchema,
  adminPayosMismatchSchema, adminPayosUncreditedSchema, adminTopUpActionRequiredSchema,
  adminTopUpTabCountsSchema, topUpStatusChangedEventSchema, topUpAdminAlertEventSchema,
  payosRecheckResultSchema,
} from './payos-top-up.schema';
import { TOP_UP_AUDIT_EVENT_TYPES, topUpMismatchAuditEventPayloadSchema, topUpRecheckAuditEventPayloadSchema } from './top-up.schema';

const id = '11111111-1111-4111-8111-111111111111';
const iso = '2026-10-16T10:00:00.000Z';

describe('top-up mismatch contracts', () => {
  it('keeps credit key distinct from existing record and notice keys', () => {
    expect(topUpMismatchKey(id)).toBe(`topup-mismatch:${id}`);
    expect(topUpMismatchNoticeKey(id, 100).startsWith(TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX)).toBe(false);
    expect('topup-mismatch-record:x'.startsWith(TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX)).toBe(false);
    expect(payosTransferContent(123456789)).toBe('RC3456789');
  });

  it('requires strict action-specific bodies and trims refund note', () => {
    expect(resolveTopUpMismatchSchema.parse({ action: 'MANUAL_REFUND', expectedAmountPaidVnd: 150, note: '  paid  ' })).toMatchObject({ note: 'paid' });
    for (const body of [
      { action: 'MANUAL_REFUND', expectedAmountPaidVnd: 150 },
      { action: 'MANUAL_REFUND', expectedAmountPaidVnd: 150, note: '   ' },
      { action: 'MANUAL_REFUND', expectedAmountPaidVnd: 150, note: 'x'.repeat(501) },
      { action: 'CREDIT', expectedAmountPaidVnd: 0 },
      { action: 'CREDIT', expectedAmountPaidVnd: 150, note: 'leak' },
    ]) expect(resolveTopUpMismatchSchema.safeParse(body).success).toBe(false);
    expect(resolveTopUpMismatchResultSchema.safeParse({ topUpId: id, status: 'MANUAL_REFUNDED', pointsCredited: null, replayed: true }).success).toBe(true);
  });

  it('rejects full account data and bounds queues', () => {
    const mismatch = {
      id, orderCode: 123, userId: id, userEmail: null, amountVnd: 10000,
      points: 50, pointsCredited: null, amountPaidVnd: 9000,
      status: 'AMOUNT_MISMATCH', createdAt: iso, paidAt: iso, expiresAt: iso,
      cancelledAt: null, resolveDueAt: iso, providerReference: null,
      transferContent: 'RC123', counterAccountBankName: null, counterAccountLast4: null,
    };
    expect(adminPayosMismatchSchema.safeParse(mismatch).success).toBe(true);
    expect(adminPayosMismatchSchema.safeParse({ ...mismatch, counterAccountNumber: '1234' }).success).toBe(false);
    expect(adminPayosMismatchSchema.safeParse({ ...mismatch, counterAccountName: 'private' }).success).toBe(false);
    const alert = { topUpId: id, orderCode: 123, userId: id, userEmail: null,
      amountVnd: 10000, amountPaidVnd: null, status: 'PROCESSING', paidAt: null, alertedAt: iso };
    expect(adminPayosUncreditedSchema.safeParse(alert).success).toBe(true);
    expect(adminTopUpActionRequiredSchema.safeParse({ uncredited: [alert], mismatches: [mismatch] }).success).toBe(true);
    expect(adminTopUpActionRequiredSchema.safeParse({ uncredited: Array(101).fill(alert), mismatches: [] }).success).toBe(false);
    expect(adminTopUpTabCountsSchema.safeParse({ payos: 1, manual: 2, actionRequired: 3 }).success).toBe(true);
  });

  it('accepts refund events but not note text in audit event', () => {
    expect(topUpStatusChangedEventSchema.safeParse({ schemaVersion: 1, topUpId: id, userId: id, orderCode: 1, amountVnd: 10000, points: 0,
      status: 'MANUAL_REFUNDED', resolution: 'ADMIN_REFUND', remainderVnd: 100, occurredAt: iso }).success).toBe(true);
    expect(topUpAdminAlertEventSchema.safeParse({ schemaVersion: 1, condition: 'UNCREDITED_AFTER_PAYMENT', paidAt: iso, occurredAt: iso }).success).toBe(true);
    expect(payosRecheckResultSchema.safeParse({ topUpId: id, status: 'MANUAL_REFUNDED', result: 'REFUNDED', amountPaidVnd: 150 }).success).toBe(true);
    expect(topUpRecheckAuditEventPayloadSchema.safeParse({ schemaVersion: 1, action: 'TOPUP_RECHECKED', auditCategory: 'MODERATION_ADMIN_ACTION',
      topUpId: id, adminId: id, orderCode: 1, result: 'REFUNDED', statusBefore: 'MANUAL_REFUNDED', statusAfter: 'MANUAL_REFUNDED', correlationId: null, occurredAt: iso }).success).toBe(true);
    const audit = { schemaVersion: 1, action: 'TOPUP_MISMATCH_RESOLVED', auditCategory: 'MODERATION_ADMIN_ACTION', topUpId: id,
      adminId: id, resolution: 'MANUAL_REFUND', amountVnd: 10000, amountPaidVnd: 9000,
      pointsCredited: null, noteLength: 4, correlationId: null, occurredAt: iso };
    expect(TOP_UP_AUDIT_EVENT_TYPES.MISMATCH_RESOLVED).toBe('AdminTopUpMismatchResolved');
    expect(topUpMismatchAuditEventPayloadSchema.safeParse(audit).success).toBe(true);
    expect(topUpMismatchAuditEventPayloadSchema.safeParse({ ...audit, note: 'private' }).success).toBe(false);
  });
});
