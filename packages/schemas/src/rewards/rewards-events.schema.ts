import { z } from 'zod';
import { REFUND_REFERENCE_PATTERN } from './redemption.schema';

const id = z.string().uuid();
const instant = z.string().datetime();

export const voucherExpiryReminderEventSchema = z.object({
  redemptionId: id,
  userId: id,
  voucherId: id,
  window: z.enum(['7D', '1D']),
  expiresAt: instant,
});

export const codeIssueReportedEventSchema = z.object({
  reportId: id,
  redemptionId: id,
  voucherId: id,
  reason: z.enum(['CODE_INVALID', 'CODE_ALREADY_USED', 'STORE_REFUSED', 'OTHER']),
});

export const codeIssueResolvedEventSchema = z
  .object({
    reportId: id,
    redemptionId: id,
    userId: id,
    voucherId: id,
    outcome: z.enum(['REPLACED', 'REFUNDED', 'REJECTED']),
    refundReference: z.string().regex(REFUND_REFERENCE_PATTERN).optional(),
  })
  .refine(
    (v) => (v.outcome === 'REFUNDED' ? !!v.refundReference : !v.refundReference),
    {
      path: ['refundReference'],
      message: 'refundReference must be present iff outcome is REFUNDED',
    },
  );

export type VoucherExpiryReminderEvent = z.infer<
  typeof voucherExpiryReminderEventSchema
>;
export type CodeIssueReportedEvent = z.infer<
  typeof codeIssueReportedEventSchema
>;
export type CodeIssueResolvedEvent = z.infer<
  typeof codeIssueResolvedEventSchema
>;
