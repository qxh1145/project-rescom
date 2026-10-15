import { z } from "zod";
import { POINT_VND_RATE } from "./top-up.schema";

export const PAYOS_TOP_UP_MIN_VND = 10_000;
export const PAYOS_TOP_UP_MAX_VND = 5_000_000;
export const PAYOS_TOP_UP_EXPIRY_MS = 5 * 60_000;
export const TOP_UP_STATUS_CHANGED_EVENT_TYPE = "ECONOMY_TOPUP_STATUS_CHANGED";
export const topUpCancelKey = (id: string): string => `topup-cancel:${id}`;

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
export const payosAvailabilitySchema = z.object({ payosEnabled: z.boolean() });
export const topUpStatusChangedEventSchema = z.object({
  schemaVersion: z.literal(1),
  topUpId: z.string().uuid(),
  userId: z.string().uuid(),
  orderCode: z.number().int(),
  amountVnd: z.number().int(),
  points: z.number().int(),
  status: z.enum(["CANCELLED"]),
  occurredAt: z.string().datetime(),
});
