import { http } from "msw";
import { walletTransactionItemSchema } from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { ledgerItemsOf, releaseDuePendingRewards, toBalanceDto, walletOf } from "../data/economy";
import { getMockSessionUser } from "../db/session";
import { ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/** Mirrors `apps/backend/src/modules/economy/presentation/ledger.controller.ts`. */

/** `ledger.service.ts#getWallet`: limit defaults to 50 and is clamped to 1…100; offset ≥ 0. */
function pageOf(url: URL): { limit: number; offset: number } {
  const limit = parseInt(url.searchParams.get("limit") ?? "", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "", 10);
  return {
    limit: Math.max(1, Math.min(Number.isNaN(limit) ? 50 : limit, 100)),
    offset: Math.max(0, Number.isNaN(offset) ? 0 : offset),
  };
}

export const economyHandlers = [
  // VERIFIED: GET /economy/wallet → walletDetailsSchema
  http.get(apiUrl("/economy/wallet"), async ({ request }) => {
    const forced = await applyScenario("wallet");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    // MOCK-ONLY stand-in for the backend maturity scan (`GET /economy/wallet` itself never
    // releases): rewards past their 48h review (or all, `?msw=release-pending`) get their
    // own `release-pending:` journal, as the backend posts it.
    releaseDuePendingRewards(user);
    const { limit, offset } = pageOf(new URL(request.url));
    // `accounts` stays empty: no screen reads it.
    return ok({
      balance: toBalanceDto(walletOf(user)),
      // The mock rows also carry `surveyTitle` for the admin ledger; the real response does not.
      transactions: ledgerItemsOf(user, limit, offset).map((item) => walletTransactionItemSchema.parse(item)),
      accounts: [],
    });
  }),
];
