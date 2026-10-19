import { http, type RequestHandler } from "msw";
import {
  accountBalanceVerificationSchema,
  accountReconciliationResultSchema,
  adminJournalListSchema,
  adminLedgerSummarySchema,
  ledgerIntegrityReportSchema,
  listAdminJournalsQuerySchema,
  maturedReleaseSummarySchema,
  parseKeysetCursor,
  releaseMaturedPendingRewardsSchema,
  rewardRedriveRequestSchema,
  rewardSettlementResultSchema,
} from "@rescom/schemas";
import { z } from "zod";
import { isAfterJournalCursor } from "@/lib/admin/admin-transactions";
import { apiUrl } from "@/lib/api/config";
import {
  adminLedgerSummary,
  ledgerOpsBalance,
  ledgerOpsIntegrity,
  ledgerOpsReconcile,
  ledgerOpsRedrive,
  ledgerOpsRelease,
  listAdminJournals,
} from "../data/admin-transactions";
import { reverseMockCredit } from "../data/admin-users";
import { fail, missingCsrf, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

const uuidParam = z.string().uuid();

/** The JSON body of a mutating call, `undefined` when absent or not JSON. */
async function jsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => undefined);
}

/**
 * Admin ledger view (Figma 11f). Both routes are VERIFIED (`lib/admin/transactions-service.ts`); the
 * query and the responses parse with the same shared schemas as the backend controller.
 */
export const adminTransactionHandlers: RequestHandler[] = [
  // VERIFIED: GET /admin/ledger/journals?type&from&to&before&limit (keyset cursor)
  http.get(apiUrl("/admin/ledger/journals"), async ({ request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const parsed = listAdminJournalsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Invalid query.", { details: parsed.error.format() });
    }
    const { type, from, to, before, limit } = parsed.data;
    const cursor = before ? parseKeysetCursor(before) : null;
    const all = listAdminJournals(type ?? "all", from ?? null, to ?? null);
    const rest = cursor ? all.filter((journal) => isAfterJournalCursor(journal, cursor)) : all;
    const items = rest.slice(0, limit);
    return ok(adminJournalListSchema.parse({ items, limit, hasMore: items.length < rest.length }));
  }),

  // VERIFIED: GET /admin/ledger/summary
  http.get(apiUrl("/admin/ledger/summary"), async () => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    return ok(adminLedgerSummarySchema.parse(adminLedgerSummary()));
  }),

  // VERIFIED (Story 14.4): ledger operator routes of `ledger.controller.ts` / `admin-reward-redrive.controller.ts`.
  http.get(apiUrl("/economy/integrity"), async () => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    return ok(ledgerIntegrityReportSchema.parse(ledgerOpsIntegrity()));
  }),

  http.get(apiUrl("/economy/accounts/:accountId/balance"), async ({ params }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    if (!uuidParam.safeParse(params.accountId).success) return fail(400, "VALIDATION_ERROR", "Invalid account id.");
    const balance = ledgerOpsBalance(String(params.accountId));
    if (!balance) return fail(404, "ACCOUNT_NOT_FOUND", "Account not found.");
    return ok(accountBalanceVerificationSchema.parse(balance));
  }),

  http.post(apiUrl("/economy/accounts/:accountId/reconcile"), async ({ params }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    if (!uuidParam.safeParse(params.accountId).success) return fail(400, "VALIDATION_ERROR", "Invalid account id.");
    const result = ledgerOpsReconcile(String(params.accountId));
    if (!result) return fail(404, "ACCOUNT_NOT_FOUND", "Account not found.");
    return ok(accountReconciliationResultSchema.parse(result));
  }),

  http.post(apiUrl("/economy/rewards/internal/:responseId"), async ({ request, params }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    if (!rewardRedriveRequestSchema.safeParse(await jsonBody(request)).success || !uuidParam.safeParse(params.responseId).success) {
      return fail(400, "VALIDATION_ERROR", "Invalid request.");
    }
    const result = ledgerOpsRedrive("internal", String(params.responseId));
    if (result === undefined) return fail(404, "RESPONSE_NOT_FOUND", "Response not found.");
    return ok(rewardSettlementResultSchema.nullable().parse(result));
  }),

  http.post(apiUrl("/economy/rewards/external/:attemptId"), async ({ request, params }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    if (!rewardRedriveRequestSchema.safeParse(await jsonBody(request)).success || !uuidParam.safeParse(params.attemptId).success) {
      return fail(400, "VALIDATION_ERROR", "Invalid request.");
    }
    const result = ledgerOpsRedrive("external", String(params.attemptId));
    if (result === undefined) return fail(404, "SURVEY_NOT_AVAILABLE", "Attempt or survey not available.");
    return ok(rewardSettlementResultSchema.nullable().parse(result));
  }),

  http.post(apiUrl("/economy/rewards/release-matured"), async ({ request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const parsed = releaseMaturedPendingRewardsSchema.safeParse(await jsonBody(request));
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid request.", { details: parsed.error.format() });
    return ok(maturedReleaseSummarySchema.parse(ledgerOpsRelease(parsed.data.limit)));
  }),

  // VERIFIED: POST /economy/journals/:id/reverse
  http.post(apiUrl("/economy/journals/:id/reverse"), async ({ params, request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;

    const id = String(params.id);
    if (!uuidParam.safeParse(id).success) {
      return fail(400, "VALIDATION_ERROR", "Invalid UUID parameter");
    }

    const body = (await jsonBody(request)) as { reason?: string } | undefined;
    const reason = typeof body?.reason === "string" ? body.reason : "";

    const result = reverseMockCredit(id, reason);
    if ("error" in result) {
      if (result.error === "JOURNAL_NOT_FOUND") {
        return fail(404, "JOURNAL_NOT_FOUND", "Journal not found.");
      }
      if (result.error === "JOURNAL_ALREADY_REVERSED") {
        return fail(409, "JOURNAL_ALREADY_REVERSED", "Journal already reversed.");
      }
      if (result.error === "INSUFFICIENT_BALANCE") {
        return fail(409, "INSUFFICIENT_BALANCE", "Insufficient balance to reverse.");
      }
      return fail(400, "VALIDATION_ERROR", "Reason is required and must be between 10 and 500 characters.");
    }
    return ok(result.journal);
  }),
];
