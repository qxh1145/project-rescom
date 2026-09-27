import { walletBalanceSchema, type WalletBalanceDto } from "@rescom/schemas";
import { apiRequest, type ResponseSchema } from "../api/client.ts";

/**
 * Only the balance part of `GET /economy/wallet` (VERIFIED,
 * `ledger.controller.ts` → `walletDetailsSchema`). The wallet screen adds the
 * full details service next to this one.
 */
const walletBalanceOnlySchema: ResponseSchema<WalletBalanceDto> = {
  safeParse(value) {
    const balance = walletBalanceSchema.safeParse(
      typeof value === "object" && value !== null ? (value as { balance?: unknown }).balance : undefined,
    );
    return balance.success ? { success: true, data: balance.data } : { success: false };
  },
};

/**
 * The route always embeds a transaction page (default 50); `limit=1` is the
 * smallest the backend accepts (`ledger.service.ts` clamps to 1…100), so the
 * header chip does not pull 50 rows it never shows.
 */
export function getWalletBalance(signal?: AbortSignal): Promise<WalletBalanceDto> {
  return apiRequest("/economy/wallet?limit=1", { schema: walletBalanceOnlySchema, signal });
}

/**
 * Header chip rule (Figma 3 vs 7): before activation the only points are the
 * frozen starter points ("100 đóng băng", lock icon); afterwards the
 * available balance ("112 điểm", coin icon).
 */
export function headerPoints(balance: WalletBalanceDto): { kind: "frozen" | "available"; amount: number } {
  return balance.available === 0 && balance.frozen > 0
    ? { kind: "frozen", amount: balance.frozen }
    : { kind: "available", amount: balance.available };
}
