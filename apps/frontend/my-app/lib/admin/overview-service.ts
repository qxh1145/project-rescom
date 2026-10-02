import { adminOverviewSchema, type AdminOverview } from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Admin "Tổng quan" (Figma 11, 62:4070).
 *
 * VERIFIED (`admin/presentation/admin-overview.controller.ts`, shared
 * `adminOverviewSchema` in `@rescom/schemas` `admin/admin-overview.schema.ts`):
 * `GET /admin/overview`, ADMIN only — one aggregate read for the dashboard:
 * - `pendingSurveys`: forms in `MODERATION_QUEUE`;
 * - `pendingTopUps`: `PENDING` top-up requests with their points and VND total;
 * - `openIssues`: open disputes + missing-code reports (disputes 0 on the real backend:
 *   disputes stay on MSW, decision Q1; missing-code reports are real);
 * - `escrow`: sum of every ESCROW ledger balance and the PUBLISHED surveys;
 * - `todo`: the oldest item of each queue ("Việc cần làm · cũ nhất trước"),
 *   `moreCount` = other items waiting in that queue (the real backend emits
 *   `SURVEY_REVIEW` and `TOP_UP` only);
 * - `flaggedAccounts`: accounts with FraudLog entries in the last 14 days
 *   (`types` = backend `FraudLogType`, a wrong completion code as `COMPLETION_CODE`).
 */
export { adminOverviewSchema, adminTodoItemSchema, flaggedAccountSchema } from "@rescom/schemas";
export type { AdminOverview, AdminTodoItem, AdminTodoKind, FlaggedAccount } from "@rescom/schemas";

export function getAdminOverview(signal?: AbortSignal): Promise<AdminOverview> {
  return apiRequest("/admin/overview", { schema: adminOverviewSchema, signal });
}
