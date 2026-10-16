import { z } from "zod";
import { MAX_PAGINATION_OFFSET } from "../common/pagination.schema";
import {
  POINT_VND_RATE,
  TOP_UP_LIST_DEFAULT_LIMIT,
  TOP_UP_LIST_MAX_LIMIT,
} from "./top-up.schema";

export const PAYOS_TOP_UP_MIN_VND = 10_000;
export const PAYOS_TOP_UP_MAX_VND = 5_000_000;
export const PAYOS_TOP_UP_EXPIRY_MS = 5 * 60_000;
export const TOP_UP_STATUS_CHANGED_EVENT_TYPE = "ECONOMY_TOPUP_STATUS_CHANGED";
export const topUpCancelKey = (id: string): string => `topup-cancel:${id}`;
export const topUpCreditKey = (id: string): string => `topup-credit:${id}`;
export const topUpExpireKey = (id: string): string => `topup-expire:${id}`;
export const TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX = "topup-mismatch:";
export const TOP_UP_MISMATCH_SLA_BUSINESS_DAYS = 3;
export const TOP_UP_MISMATCH_NOTE_MAX = 500;
export const TOP_UP_ACTION_REQUIRED_MAX = 100;
export const topUpMismatchKey = (id: string): string => `${TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX}${id}`;
export const payosTransferContent = (orderCode: number): string => `RC${String(orderCode).slice(-7)}`;
export const topUpMismatchNoticeKey = (id: string, amountPaidVnd: number): string =>
  `topup-mismatch-notice:${id}:${amountPaidVnd}`;

export const payosCheckoutSchema = z.object({
  amountVnd: z
    .number()
    .int()
    .min(PAYOS_TOP_UP_MIN_VND)
    .max(PAYOS_TOP_UP_MAX_VND)
    .refine(
      (value) => value % POINT_VND_RATE === 0,
      "amountVnd must be a multiple of 200",
    ),
});
export type PayosCheckoutInput = z.infer<typeof payosCheckoutSchema>;
import {
  topUpRefundUnavailableReasonSchema,
  userTopUpRefundRequestSchema,
} from "./top-up-refund.schema";

export const payosTopUpStatusSchema = z.enum([
  "PROCESSING",
  "SUCCESSFUL",
  "CANCELLED",
  "EXPIRED",
  "AMOUNT_MISMATCH",
  "MANUAL_REFUNDED",
]);
export type PayosTopUpStatus = z.infer<typeof payosTopUpStatusSchema>;

export const payosTopUpSchema = z.object({
  id: z.string().uuid(),
  orderCode: z.number().int(),
  amountVnd: z.number().int(),
  points: z.number().int(),
  status: payosTopUpStatusSchema,
  checkoutUrl: z.string().nullable(),
  expiresAt: z.string().datetime(),
  cancelledAt: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  refundDeadline: z.string().datetime().nullable(),
  refund: z.object({
    canRequest: z.boolean(),
    unavailableReason: topUpRefundUnavailableReasonSchema.nullable(),
    request: userTopUpRefundRequestSchema.nullable(),
  }),
});
export type PayosTopUpDto = z.infer<typeof payosTopUpSchema>;
export const payosCheckoutResultSchema = z.object({
  topUp: payosTopUpSchema,
  checkoutUrl: z.string(),
});
export type PayosCheckoutResultDto = z.infer<typeof payosCheckoutResultSchema>;
export const payosAvailabilitySchema = z.object({ payosEnabled: z.boolean() });
export type PayosAvailability = z.infer<typeof payosAvailabilitySchema>;


export const listPayosTopUpsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(TOP_UP_LIST_MAX_LIMIT, `limit must be at most ${TOP_UP_LIST_MAX_LIMIT}`)
      .default(TOP_UP_LIST_DEFAULT_LIMIT),
    offset: z.coerce
      .number()
      .int("offset must be an integer")
      .min(0, "offset cannot be negative")
      .max(MAX_PAGINATION_OFFSET, `offset must be at most ${MAX_PAGINATION_OFFSET}`)
      .default(0),
  })
  .strict();
export type ListPayosTopUpsQuery = z.input<typeof listPayosTopUpsQuerySchema>;
/** After parsing: defaults applied, limit/offset always numbers (use in handlers/services). */
export type ParsedListPayosTopUpsQuery = z.output<typeof listPayosTopUpsQuerySchema>;


export const payosTopUpListSchema = z.object({
  items: z.array(payosTopUpSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type PayosTopUpListDto = z.infer<typeof payosTopUpListSchema>;

export const topUpStatusChangedEventSchema = z.object({
  schemaVersion: z.literal(1),
  topUpId: z.string().uuid(),
  userId: z.string().uuid(),
  orderCode: z.number().int(),
  amountVnd: z.number().int(),
  points: z.number().int(),
  status: z.enum(["CANCELLED", "SUCCESSFUL", "AMOUNT_MISMATCH", "EXPIRED", "MANUAL_REFUNDED"]),
  amountPaidVnd: z.number().int().nonnegative().optional(),
  resolution: z.enum(["ADMIN_CREDIT", "ADMIN_REFUND"]).optional(),
  remainderVnd: z.number().int().nonnegative().optional(),
  occurredAt: z.string().datetime(),
});
export type TopUpStatusChangedEvent = z.infer<typeof topUpStatusChangedEventSchema>;

export const TOP_UP_ADMIN_ALERT_EVENT_TYPE = "ECONOMY_TOPUP_ADMIN_ALERT";

export const topUpAdminAlertConditionSchema = z.enum([
  "UNCREDITED_AFTER_PAYMENT",
  "MISMATCH_SLA_BREACHED",
  "PAID_ON_CLOSED_LINK",
  "PROVIDER_FAILURE",
]);
export type TopUpAdminAlertCondition = z.infer<typeof topUpAdminAlertConditionSchema>;

export const topUpAdminAlertEventSchema = z.object({
  schemaVersion: z.literal(1),
  condition: topUpAdminAlertConditionSchema,
  topUpId: z.string().uuid().optional(),
  orderCode: z.number().int().optional(),
  amountVnd: z.number().int().optional(),
  amountPaidVnd: z.number().int().optional(),
  paidAt: z.string().datetime().optional(),
  occurredAt: z.string().datetime(),
});
export type TopUpAdminAlertEvent = z.infer<typeof topUpAdminAlertEventSchema>;

export const topUpAlertKey = (
  condition: TopUpAdminAlertCondition,
  subject: string,
): string => `topup-alert:${condition}:${subject}`;

export const payosRecheckResultSchema = z.object({
  topUpId: z.string().uuid(),
  result: z.enum(["CREDITED", "STILL_UNPAID", "MISMATCH", "REFUNDED"]),
  status: payosTopUpStatusSchema,
  amountPaidVnd: z.number().int().nonnegative().nullable(),
});
export type PayosRecheckResultDto = z.infer<typeof payosRecheckResultSchema>;
export type PayosRecheckResult = PayosRecheckResultDto;


const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((key) => {
  const day = new Date(`${key}T00:00:00.000Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === key;
}, 'Invalid date');

export const adminPayosTopUpSchema = z.object({
  id: z.string().uuid(), orderCode: z.number().int(), userId: z.string().uuid(),
  userEmail: z.string().nullable(), amountVnd: z.number().int(), points: z.number().int(),
  pointsCredited: z.number().int().nullable(), amountPaidVnd: z.number().int().nullable(),
  status: payosTopUpStatusSchema, createdAt: z.string().datetime(),
  paidAt: z.string().datetime().nullable(), expiresAt: z.string().datetime(),
  cancelledAt: z.string().datetime().nullable(),
}).strict();
export type AdminPayosTopUp = z.infer<typeof adminPayosTopUpSchema>;

export const listAdminPayosTopUpsQuerySchema = listPayosTopUpsQuerySchema.extend({
  status: payosTopUpStatusSchema.optional(), from: dateKeySchema.optional(),
  to: dateKeySchema.optional(), q: z.string().trim().min(1).max(100).optional(),
}).strict().refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['from'], message: 'from cannot be after to' });
export type ListAdminPayosTopUpsQuery = z.output<typeof listAdminPayosTopUpsQuerySchema>;
export const adminPayosTopUpListSchema = z.object({
  items: z.array(adminPayosTopUpSchema), total: z.number().int().nonnegative(),
  limit: z.number().int().positive(), offset: z.number().int().nonnegative(), hasMore: z.boolean(),
}).strict();
export const resolveTopUpMismatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREDIT"), expectedAmountPaidVnd: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("MANUAL_REFUND"), expectedAmountPaidVnd: z.number().int().positive(),
    note: z.string().trim().min(1).max(TOP_UP_MISMATCH_NOTE_MAX) }).strict(),
]);
export type ResolveTopUpMismatch = z.infer<typeof resolveTopUpMismatchSchema>;
export type ResolveTopUpMismatchInput = z.input<typeof resolveTopUpMismatchSchema>;
export const resolveTopUpMismatchResultSchema = z.object({
  topUpId: z.string().uuid(), status: z.enum(["SUCCESSFUL", "MANUAL_REFUNDED"]),
  pointsCredited: z.number().int().nullable(), replayed: z.boolean(),
}).strict();
export type ResolveTopUpMismatchResult = z.infer<typeof resolveTopUpMismatchResultSchema>;
export const adminPayosMismatchSchema = adminPayosTopUpSchema.extend({
  resolveDueAt: z.string().datetime(), providerReference: z.string().nullable(),
  transferContent: z.string(), counterAccountBankName: z.string().nullable(),
  counterAccountLast4: z.string().nullable(),
}).strict();
export type AdminPayosMismatch = z.infer<typeof adminPayosMismatchSchema>;
export const adminPayosUncreditedSchema = z.object({
  topUpId: z.string().uuid(), orderCode: z.number().int(), userId: z.string().uuid(),
  userEmail: z.string().nullable(), amountVnd: z.number().int(),
  amountPaidVnd: z.number().int().nullable(), status: payosTopUpStatusSchema,
  paidAt: z.string().datetime().nullable(), alertedAt: z.string().datetime(),
}).strict();
export type AdminPayosUncredited = z.infer<typeof adminPayosUncreditedSchema>;
// ponytail: capped queues; add paging when either queue routinely exceeds 100 rows.
export const adminTopUpActionRequiredSchema = z.object({
  uncredited: z.array(adminPayosUncreditedSchema).max(TOP_UP_ACTION_REQUIRED_MAX),
  mismatches: z.array(adminPayosMismatchSchema).max(TOP_UP_ACTION_REQUIRED_MAX),
}).strict();
export type AdminTopUpActionRequired = z.infer<typeof adminTopUpActionRequiredSchema>;
export const adminTopUpTabCountsSchema = z.object({ payos: z.number().int().nonnegative(), manual: z.number().int().nonnegative(), actionRequired: z.number().int().nonnegative() }).strict();
export const PAYOS_TOP_UP_EXPORT_MAX_ROWS = 10_000;
export const exportAdminPayosTopUpsSchema = z.object({ from: dateKeySchema, to: dateKeySchema }).strict()
  .refine(({ from, to }) => from <= to, { path: ['from'], message: 'from cannot be after to' })
  .refine(({ from, to }) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 < 366,
    { path: ['to'], message: 'Range cannot exceed 366 days' });
export type ExportAdminPayosTopUps = z.infer<typeof exportAdminPayosTopUpsSchema>;
