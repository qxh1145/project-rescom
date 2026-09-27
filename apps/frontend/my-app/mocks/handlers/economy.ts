import { http } from "msw";
import { apiUrl } from "@/lib/api/config";
import { toBalanceDto, walletOf } from "../data/economy";
import { getMockSessionUser } from "../db/session";
import { ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Mirrors `apps/backend/src/modules/economy/presentation/ledger.controller.ts`.
 * `transactions`/`accounts` are filled in by the wallet phase.
 */
export const economyHandlers = [
  // VERIFIED: GET /economy/wallet → walletDetailsSchema
  http.get(apiUrl("/economy/wallet"), async () => {
    const forced = await applyScenario("wallet");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    return ok({ balance: toBalanceDto(walletOf(user)), transactions: [], accounts: [] });
  }),
];
