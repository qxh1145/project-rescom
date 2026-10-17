import { z } from 'zod';

export const TOP_UP_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

export function topUpRefundDeadline(paidAt: Date): Date {
  return new Date(paidAt.getTime() + TOP_UP_REFUND_WINDOW_MS);
}

export const TOP_UP_REFUND_NOTE_MAX = 300;
export const TOP_UP_REFUND_SLA_BUSINESS_DAYS = 3;
export const TOP_UP_REFUND_REJECTION_REASON_MAX = 500;
export const TOP_UP_REFUND_BANK_REFERENCE_MAX = 100;

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

export const userTopUpRefundDestinationViewSchema = userTopUpRefundDestinationSchema
  .extend({
    // Optional so an FE deployed before the BE (Story 13.11) still parses; missing = null.
    accountNumber: z.string().nullable().optional(),
  })
  .strict();
export type UserTopUpRefundDestinationView = z.infer<typeof userTopUpRefundDestinationViewSchema>;

export const userTopUpRefundRequestSchema = z
  .object({
    id: z.string().uuid(),
    status: topUpRefundStatusSchema,
    eligibility: topUpRefundEligibilitySchema,
    ineligibleReason: topUpRefundIneligibleReasonSchema.nullable(),
    reason: topUpRefundReasonSchema,
    points: z.number().int().positive(),
    amountVnd: z.number().int().positive(),
    destination: userTopUpRefundDestinationViewSchema,
    submittedAt: z.string().datetime(),
    withdrawnAt: z.string().datetime().nullable(),
    resolvedAt: z.string().datetime().nullable().optional(),
    rejectionReason: z.string().max(TOP_UP_REFUND_REJECTION_REASON_MAX).nullable().optional(),
    bankTransferReference: z.string().max(TOP_UP_REFUND_BANK_REFERENCE_MAX).nullable().optional(),
    bankTransferredAt: z.string().datetime().nullable().optional(),
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

export const resolveTopUpRefundSchema = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('REFUNDED'),
      destinationConfirmed: z.boolean().optional(),
      bankTransferReference: z
        .string()
        .trim()
        .min(1)
        .max(TOP_UP_REFUND_BANK_REFERENCE_MAX)
        .optional(),
      bankTransferredAt: z.string().datetime().optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal('REJECTED'),
      reason: z
        .string()
        .trim()
        .min(1)
        .max(TOP_UP_REFUND_REJECTION_REASON_MAX),
      manualTransferRecorded: z.boolean().default(false),
    })
    .strict(),
]);
export type ResolveTopUpRefund = z.infer<typeof resolveTopUpRefundSchema>;
export type ResolveTopUpRefundInput = z.input<typeof resolveTopUpRefundSchema>;

export const recordTopUpRefundBankTransferSchema = z
  .object({
    bankTransferReference: z
      .string()
      .trim()
      .min(1)
      .max(TOP_UP_REFUND_BANK_REFERENCE_MAX)
      .optional(),
    bankTransferredAt: z.string().datetime().optional(),
  })
  .strict()
  .refine(
    (val) =>
      val.bankTransferReference !== undefined || val.bankTransferredAt !== undefined,
    {
      message:
        'At least one of bankTransferReference or bankTransferredAt must be provided',
    },
  );
export type RecordTopUpRefundBankTransfer = z.infer<
  typeof recordTopUpRefundBankTransferSchema
>;
export type RecordTopUpRefundBankTransferInput = z.input<
  typeof recordTopUpRefundBankTransferSchema
>;

export const adminTopUpRefundListItemSchema = z
  .object({
    id: z.string().uuid(),
    topUpId: z.string().uuid(),
    orderCode: z.number().int(),
    userId: z.string().uuid(),
    userEmail: z.string().nullable(),
    userName: z.string().nullable(),
    amountVnd: z.number().int().positive(),
    points: z.number().int().positive(),
    status: topUpRefundStatusSchema,
    eligibility: topUpRefundEligibilitySchema,
    ineligibleReason: topUpRefundIneligibleReasonSchema.nullable(),
    reason: topUpRefundReasonSchema,
    destinationVerified: z.boolean(),
    heldPoints: z.number().int().nonnegative(),
    submittedAt: z.string().datetime(),
    dueAt: z.string().datetime(),
    overdue: z.boolean(),
    resolvedAt: z.string().datetime().nullable(),
  })
  .strict();
export type AdminTopUpRefundListItem = z.infer<typeof adminTopUpRefundListItemSchema>;

export const adminTopUpRefundDestinationSchema = z
  .object({
    bankId: z.string().nullable(),
    bankName: z.string().nullable(),
    holderName: z.string().nullable(),
    accountNumber: z.string().nullable(),
    verified: z.boolean(),
  })
  .strict();
export type AdminTopUpRefundDestination = z.infer<typeof adminTopUpRefundDestinationSchema>;

export const adminTopUpRefundDetailSchema = adminTopUpRefundListItemSchema
  .extend({
    note: z.string(),
    paidAt: z.string().datetime(),
    providerReference: z.string().nullable(),
    destination: adminTopUpRefundDestinationSchema,
    rejectionReason: z.string().nullable(),
    manualTransferRecorded: z.boolean(),
    bankTransferReference: z.string().nullable(),
    bankTransferredAt: z.string().datetime().nullable(),
    bankTransferRecordedAt: z.string().datetime().nullable(),
    withdrawnAt: z.string().datetime().nullable(),
    resolvedBy: z
      .object({
        id: z.string().uuid(),
        email: z.string().nullable(),
      })
      .nullable(),
    holdJournalId: z.string().uuid().nullable(),
    resolveJournalId: z.string().uuid().nullable(),
  })
  .strict();
export type AdminTopUpRefundDetail = z.infer<typeof adminTopUpRefundDetailSchema>;

export const adminTopUpRefundListQuerySchema = z
  .object({
    status: z.enum(['OPEN', 'RESOLVED', 'ALL']).default('OPEN'),
    verdict: z.enum(['ALL', 'ELIGIBLE', 'NOT_ELIGIBLE']).default('ALL'),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type AdminTopUpRefundListQuery = z.infer<typeof adminTopUpRefundListQuerySchema>;
export type AdminTopUpRefundListQueryInput = z.input<typeof adminTopUpRefundListQuerySchema>;

export const adminTopUpRefundListResponseSchema = z
  .object({
    items: z.array(adminTopUpRefundListItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().positive(),
  })
  .strict();
export type AdminTopUpRefundListResponse = z.infer<typeof adminTopUpRefundListResponseSchema>;

export const adminResolveTopUpRefundResultSchema = z
  .object({
    request: adminTopUpRefundDetailSchema,
    replayed: z.boolean(),
  })
  .strict();
export type AdminResolveTopUpRefundResult = z.infer<typeof adminResolveTopUpRefundResultSchema>;

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
    status: z.enum(['REQUESTED', 'WITHDRAWN', 'REFUNDED', 'REJECTED']),
    eligibility: topUpRefundEligibilitySchema,
    ineligibleReason: topUpRefundIneligibleReasonSchema.nullable(),
    points: z.number().int(),
    amountVnd: z.number().int(),
    rejectionReason: z
      .string()
      .max(TOP_UP_REFUND_REJECTION_REASON_MAX)
      .nullable()
      .optional(),
    // True when the user's held Points were released back to Available
    // (REJECTED/WITHDRAWN). Optional: Outbox events queued before this field existed omit it.
    holdReleased: z.boolean().optional(),
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
