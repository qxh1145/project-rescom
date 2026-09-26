import { walletDetailsSchema, type WalletDetailsDto } from "@rescom/schemas";

export interface FetchWalletOptions {
  signal?: AbortSignal;
}

export async function fetchWalletDetails(
  options?: FetchWalletOptions,
): Promise<WalletDetailsDto> {
  const res = await fetch("/api/economy/wallet", {
    signal: options?.signal,
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Authentication required. Please log in to view your wallet.");
    }
    const errorJson = await res.json().catch(() => null);
    throw new Error(errorJson?.error?.message || "Failed to load wallet details");
  }

  const json = await res.json();
  const parsed = walletDetailsSchema.safeParse(json?.data);
  if (!parsed.success) {
    throw new Error("Received malformed wallet details response from server");
  }

  return parsed.data;
}
