import { z } from 'zod';

export const TOP_UP_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

export function topUpRefundDeadline(paidAt: Date): Date {
  return new Date(paidAt.getTime() + TOP_UP_REFUND_WINDOW_MS);
}

export const TOP_UP_REFUND_NOTE_MAX = 300;

export const topUpRefundReasonSchema = z.enum([
  'WRONG_AMOUNT',
  'WRONG_ACCOUNT',
  'NO_LONGER_NEEDED',
  'OTHER',
]);
export type TopUpRefundReason = z.infer<typeof topUpRefundReasonSchema>;

export const topUpRefundStatusSchema = z.enum([
  'REQUESTED',
  'WITHDRAWN',
  'REFUNDED',
  'REJECTED',
]);
export type TopUpRefundStatus = z.infer<typeof topUpRefundStatusSchema>;

export const topUpRefundEligibilitySchema = z.enum(['ELIGIBLE', 'NOT_ELIGIBLE']);
export type TopUpRefundEligibility = z.infer<typeof topUpRefundEligibilitySchema>;

export const topUpRefundIneligibleReasonSchema = z.enum([
  'SPENT_SINCE_TOP_UP',
  'INSUFFICIENT_AVAILABLE',
]);
export type TopUpRefundIneligibleReason = z.infer<typeof topUpRefundIneligibleReasonSchema>;

export const topUpRefundUnavailableReasonSchema = z.enum([
  'NOT_SUCCESSFUL',
  'LEGACY_MANUAL',
  'DEADLINE_PASSED',
  'MISMATCH_CREDITED',
  'ALREADY_REQUESTED',
  'WITHDRAWN',
]);
export type TopUpRefundUnavailableReason = z.infer<typeof topUpRefundUnavailableReasonSchema>;

export const submitTopUpRefundSchema = z
  .object({
    reason: topUpRefundReasonSchema,
    note: z.string().trim().min(1).max(TOP_UP_REFUND_NOTE_MAX),
  })
  .strict();
export type SubmitTopUpRefundInput = z.infer<typeof submitTopUpRefundSchema>;

export const userTopUpRefundDestinationSchema = z
  .object({
    bankId: z.string().nullable(),
    bankName: z.string().nullable(),
    holderName: z.string().nullable(),
    last4: z.string().nullable(),
    verified: z.boolean(),
  })
  .strict();
export type UserTopUpRefundDestination = z.infer<typeof userTopUpRefundDestinationSchema>;

export const userTopUpRefundRequestSchema = z
  .object({
    id: z.string().uuid(),
    status: topUpRefundStatusSchema,
    eligibility: topUpRefundEligibilitySchema,
    ineligibleReason: topUpRefundIneligibleReasonSchema.nullable(),
    reason: topUpRefundReasonSchema,
    points: z.number().int().positive(),
    amountVnd: z.number().int().positive(),
    destination: userTopUpRefundDestinationSchema,
    submittedAt: z.string().datetime(),
    withdrawnAt: z.string().datetime().nullable(),
  })
  .strict();
export type UserTopUpRefundRequest = z.infer<typeof userTopUpRefundRequestSchema>;

export const topUpRefundResultSchema = z
  .object({
    request: userTopUpRefundRequestSchema,
    replayed: z.boolean(),
  })
  .strict();
export type TopUpRefundResult = z.infer<typeof topUpRefundResultSchema>;

export const topUpRefundHoldKey = (id: string): string => `topup-refund-hold:${id}`;
export const topUpRefundWithdrawKey = (id: string): string => `topup-refund-withdraw:${id}`;
export const topUpRefundResolveKey = (id: string): string => `topup-refund-resolve:${id}`;

export const TOP_UP_REFUND_HOLD_KEY_PREFIX = 'topup-refund-hold:';
export const TOP_UP_REFUND_WITHDRAW_KEY_PREFIX = 'topup-refund-withdraw:';
export const TOP_UP_REFUND_RESOLVE_KEY_PREFIX = 'topup-refund-resolve:';

export const TOP_UP_REFUND_CHANGED_EVENT_TYPE = 'ECONOMY_TOPUP_REFUND_CHANGED';
export const TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE = 'ECONOMY_TOPUP_REFUND_ADMIN_NOTICE';

export const topUpRefundChangedPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    topUpId: z.string().uuid(),
    userId: z.string().uuid(),
    orderCode: z.number().int(),
    status: z.enum(['REQUESTED', 'WITHDRAWN']),
    eligibility: topUpRefundEligibilitySchema,
    ineligibleReason: topUpRefundIneligibleReasonSchema.nullable(),
    points: z.number().int(),
    amountVnd: z.number().int(),
    occurredAt: z.string().datetime(),
  })
  .strict();
export type TopUpRefundChangedPayload = z.infer<typeof topUpRefundChangedPayloadSchema>;

export const topUpRefundAdminNoticePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    topUpId: z.string().uuid(),
    userId: z.string().uuid(),
    orderCode: z.number().int(),
    status: z.enum(['REQUESTED', 'WITHDRAWN']),
    eligibility: topUpRefundEligibilitySchema,
    ineligibleReason: topUpRefundIneligibleReasonSchema.nullable(),
    points: z.number().int(),
    amountVnd: z.number().int(),
    occurredAt: z.string().datetime(),
    userEmail: z.string().nullable(),
    reason: topUpRefundReasonSchema,
    note: z.string().max(TOP_UP_REFUND_NOTE_MAX),
    destination: userTopUpRefundDestinationSchema,
  })
  .strict();
export type TopUpRefundAdminNoticePayload = z.infer<typeof topUpRefundAdminNoticePayloadSchema>;
