import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Admin "Tổng quan" (Figma 11, 62:4070).
 *
 * ASSUMED API CONTRACT: `GET /admin/overview` — one aggregate read for the
 * dashboard. The backend has no aggregate route: the VERIFIED section routes
 * (`GET /admin/moderation/surveys`, `GET /admin/top-ups`) would need one
 * request per queue, `GET /economy/integrity` only reports the ledger
 * zero-sum check (`totalSystemBalance`, `isZeroSum`) and there is no escrow
 * total nor FraudLog read route. Shape (frontend-designed):
 * - `pendingSurveys`: forms in `MODERATION_QUEUE`;
 * - `pendingTopUps`: `PENDING` top-up requests with their points and VND total;
 * - `openIssues`: open disputes + missing-code reports;
 * - `escrow`: sum of the ESCROW account balances of running (PUBLISHED) surveys;
 * - `todo`: the oldest item of each queue ("Việc cần làm · cũ nhất trước"),
 *   `moreCount` = other items waiting in that queue;
 * - `flaggedAccounts`: accounts the system flagged for repeated FraudLog
 *   violations (`types` = backend `FraudLogType`, plus the ASSUMED
 *   `COMPLETION_CODE` for wrong completion codes).
 */

const todoBase = {
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  /** Other items waiting in the same queue ("+2 khảo sát khác"). */
  moreCount: z.number().int().nonnegative(),
  /** "Ưu tiên": the respondent's points are waiting on this item. */
  priority: z.boolean(),
};

export const adminTodoItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("DISPUTE"),
    ...todoBase,
    /** Short attempt reference ("7F3A"). */
    attemptRef: z.string().min(1),
    respondentName: z.string().min(1),
    surveyTitle: z.string().min(1),
    /** When the disputed pending reward would have been released (48h review). */
    pendingReleasesAt: z.string().datetime().nullable(),
  }),
  z.object({
    kind: z.literal("SURVEY_REVIEW"),
    ...todoBase,
    surveyTitle: z.string().min(1),
    publisherName: z.string().min(1),
    surveyType: z.enum(["INTERNAL", "EXTERNAL"]),
  }),
  z.object({
    kind: z.literal("TOP_UP"),
    ...todoBase,
    points: z.number().int().positive(),
    amountVnd: z.number().int().nonnegative(),
    requesterName: z.string().min(1),
    transferReference: z.string().min(1),
  }),
  z.object({
    kind: z.literal("MISSING_CODE"),
    ...todoBase,
    surveyTitle: z.string().min(1),
    reporterRole: z.enum(["RESPONDENT", "PUBLISHER"]),
  }),
]);
export type AdminTodoItem = z.infer<typeof adminTodoItemSchema>;
export type AdminTodoKind = AdminTodoItem["kind"];

export const flaggedAccountSchema = z.object({
  userId: z.string().uuid(),
  /** Short public reference ("7F3A"). */
  reference: z.string().min(1),
  violationCount: z.number().int().positive(),
  windowDays: z.number().int().positive(),
  types: z.array(z.string().min(1)),
  /** Flagged for repeated violations ("Lặp lại"). */
  repeated: z.boolean(),
});
export type FlaggedAccount = z.infer<typeof flaggedAccountSchema>;

export const adminOverviewSchema = z.object({
  pendingSurveys: z.object({ count: z.number().int().nonnegative() }),
  pendingTopUps: z.object({
    count: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
    amountVnd: z.number().int().nonnegative(),
  }),
  openIssues: z.object({
    disputes: z.number().int().nonnegative(),
    missingCodeReports: z.number().int().nonnegative(),
  }),
  escrow: z.object({
    points: z.number().int().nonnegative(),
    runningSurveys: z.number().int().nonnegative(),
  }),
  todo: z.array(adminTodoItemSchema),
  flaggedAccounts: z.array(flaggedAccountSchema),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export function getAdminOverview(signal?: AbortSignal): Promise<AdminOverview> {
  return apiRequest("/admin/overview", { schema: adminOverviewSchema, signal });
}
