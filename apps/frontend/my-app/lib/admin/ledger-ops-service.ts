import {
  accountBalanceVerificationSchema,
  accountReconciliationResultSchema,
  ledgerIntegrityReportSchema,
  maturedReleaseSummarySchema,
  rewardSettlementResultSchema,
  type AccountBalanceVerification,
  type AccountReconciliationResult,
  type LedgerIntegrityReport,
  type MaturedReleaseSummaryDto,
  type RewardSettlementResultDto,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import type { RedriveTarget } from "./ledger-ops-view.ts";

/**
 * Admin · Vận hành sổ cái (Story 14.4), ADMIN only.
 *
 * VERIFIED (`economy/presentation/ledger.controller.ts`,
 * `participation/presentation/admin-reward-redrive.controller.ts`, shared schemas
 * in `@rescom/schemas` `economy/ledger-ops.schema.ts` / `reward.schema.ts`):
 * - `GET /economy/integrity` → zero-sum result + `driftedAccounts` (max
 *   `LEDGER_DRIFT_REPORT_LIMIT`, by account id) + `driftedAccountsTruncated`.
 * - `GET /economy/accounts/:id/balance` → projected vs calculated balance.
 * - `POST /economy/accounts/:id/reconcile` (no body) → `priorBalance` →
 *   `correctedBalance`; updates only on drift.
 * - `POST /economy/rewards/internal/:responseId` / `external/:attemptId`
 *   (strict `{}`) → settlement result; External may answer `null`.
 * - `POST /economy/rewards/release-matured` (strict `{ after?, limit? }`) →
 *   `MaturedReleaseSummary`; `after` = the previous `nextCursor`.
 * Every mutating call carries the CSRF token (`apiRequest`). The client never
 * sends amounts or users: the server derives them from the id.
 */

export type {
  AccountBalanceVerification,
  AccountReconciliationResult,
  LedgerIntegrityReport,
  MaturedReleaseSummaryDto as MaturedReleaseSummary,
  RewardSettlementResultDto,
};

export function getLedgerIntegrity(signal?: AbortSignal): Promise<LedgerIntegrityReport> {
  return apiRequest("/economy/integrity", { schema: ledgerIntegrityReportSchema, signal });
}

export function getAccountBalance(accountId: string, signal?: AbortSignal): Promise<AccountBalanceVerification> {
  return apiRequest(`/economy/accounts/${encodeURIComponent(accountId)}/balance`, {
    schema: accountBalanceVerificationSchema,
    signal,
  });
}

export function reconcileAccount(accountId: string): Promise<AccountReconciliationResult> {
  return apiRequest(`/economy/accounts/${encodeURIComponent(accountId)}/reconcile`, {
    method: "POST",
    schema: accountReconciliationResultSchema,
  });
}

/** `null` = the External settlement is unavailable ("Chưa có kết quả trả thưởng."). */
export function redriveReward(kind: RedriveTarget, id: string): Promise<RewardSettlementResultDto | null> {
  const schema = rewardSettlementResultSchema.nullable();
  const encoded = encodeURIComponent(id);
  // Two literal calls: the contract-callsites gate matches each to its backend route and e2e call.
  return kind === "internal"
    ? apiRequest(`/economy/rewards/internal/${encoded}`, { method: "POST", body: {}, schema })
    : apiRequest(`/economy/rewards/external/${encoded}`, { method: "POST", body: {}, schema });
}

export function releaseMaturedRewards(input: { limit?: number; after?: string }): Promise<MaturedReleaseSummaryDto> {
  const body: { limit?: number; after?: string } = {};
  if (input.limit !== undefined) body.limit = input.limit;
  if (input.after !== undefined) body.after = input.after;
  return apiRequest("/economy/rewards/release-matured", {
    method: "POST",
    body,
    schema: maturedReleaseSummarySchema,
  });
}
