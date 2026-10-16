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
  status: z.enum(["CANCELLED", "SUCCESSFUL", "AMOUNT_MISMATCH", "EXPIRED"]),
  amountPaidVnd: z.number().int().nonnegative().optional(),
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
  occurredAt: z.string().datetime(),
});
export type TopUpAdminAlertEvent = z.infer<typeof topUpAdminAlertEventSchema>;

export const topUpAlertKey = (
  condition: TopUpAdminAlertCondition,
  subject: string,
): string => `topup-alert:${condition}:${subject}`;

export const payosRecheckResultSchema = z.object({
  topUpId: z.string().uuid(),
  result: z.enum(["CREDITED", "STILL_UNPAID", "MISMATCH"]),
  status: payosTopUpStatusSchema,
  amountPaidVnd: z.number().int().nonnegative().nullable(),
});
export type PayosRecheckResultDto = z.infer<typeof payosRecheckResultSchema>;
export type PayosRecheckResult = PayosRecheckResultDto;

