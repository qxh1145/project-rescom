import { z } from "zod";

// Audit summaries contain metadata only; voucher codes are bearer secrets.
const summary = z.object({
  title: z.string().min(1).optional(),
  state: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
  isVisible: z.boolean().optional(),
  basePoints: z.number().int().positive().optional(),
  promoPoints: z.number().int().positive().nullable().optional(),
  priceVersion: z.number().int().positive().optional(),
  stockTotal: z.number().int().nonnegative().optional(),
  stockRemaining: z.number().int().nonnegative().optional(),
  codesImported: z.number().int().nonnegative().optional(),
  deviation: z.boolean().optional(),
}).strict();

export const rewardsAdminAuditEventPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  auditCategory: z.literal("REWARDS_ADMIN_ACTION"),
  action: z.enum(["VOUCHER_CREATED", "VOUCHER_UPDATED", "VOUCHER_STATE_CHANGED", "VOUCHER_PRICE_CHANGED", "VOUCHER_STOCK_ADJUSTED", "VOUCHER_CODES_IMPORTED"]),
  voucherId: z.string().uuid(),
  adminId: z.string().uuid(),
  before: summary.nullable(),
  after: summary,
  correlationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});
export type RewardsAdminAuditEventPayload = z.infer<typeof rewardsAdminAuditEventPayloadSchema>;
