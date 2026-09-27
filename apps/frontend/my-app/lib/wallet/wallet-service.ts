import { z } from "zod";
import {
  walletBalanceSchema,
  walletDetailsSchema,
  walletTransactionItemSchema,
  type WalletBalanceDto,
} from "@rescom/schemas";
import { apiRequest, type ResponseSchema } from "../api/client.ts";

/**
 * One ledger entry of `GET /economy/wallet` (VERIFIED
 * `walletTransactionItemSchema`) plus `surveyTitle`.
 *
 * ASSUMED API CONTRACT: `surveyTitle` — Figma 7 shows the survey title of
 * reward rows ("Khảo sát / ghi chú"), but the backend only returns the
 * journal `description` (English, with the attempt id). Optional so the
 * verified backend response still parses; the history then falls back to a
 * generic note (`wallet-history.ts`).
 */
export const walletTransactionSchema = walletTransactionItemSchema.extend({
  surveyTitle: z.string().min(1).nullable().optional(),
});
export type WalletTransaction = z.infer<typeof walletTransactionSchema>;

export const walletViewSchema = walletDetailsSchema.extend({
  transactions: z.array(walletTransactionSchema),
});
export type WalletView = z.infer<typeof walletViewSchema>;

/** Figma 7 "Lịch sử giao dịch" page size (backend default 50, clamps to 1…100). */
export const WALLET_HISTORY_LIMIT = 50;

/**
 * VERIFIED: `GET /economy/wallet?limit&offset` (`ledger.controller.ts` →
 * `ledger.service.ts#getWallet`): balance buckets + the ledger entries of the
 * caller's own accounts, newest first, from `offset` ("Tải thêm"). A page of
 * exactly `WALLET_HISTORY_LIMIT` entries means there may be more. There is
 * no type filter: Nhận / Chi / Nạp are applied client-side (`filterHistory`).
 */
export function getWalletDetails(signal?: AbortSignal, offset = 0): Promise<WalletView> {
  const query = offset > 0 ? `limit=${WALLET_HISTORY_LIMIT}&offset=${offset}` : `limit=${WALLET_HISTORY_LIMIT}`;
  return apiRequest(`/economy/wallet?${query}`, { schema: walletViewSchema, signal });
}

/**
 * Only the balance part of `GET /economy/wallet` (VERIFIED,
 * `ledger.controller.ts` → `walletDetailsSchema`), for the header chip.
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
