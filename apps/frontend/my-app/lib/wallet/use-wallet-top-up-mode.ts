"use client";

import { useEffect, useState } from "react";
import { getPayosAvailability } from "@/lib/wallet/payos-top-up-service";

export type WalletTopUpMode = "loading" | "payos" | "manual" | "error";

export function useWalletTopUpMode(): {
  mode: WalletTopUpMode;
  reload: () => void;
} {
  const [mode, setMode] = useState<WalletTopUpMode>("loading");
  const [nonce, setNonce] = useState(0);

  const reload = () => {
    setMode("loading");
    setNonce((n) => n + 1);
  };

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    getPayosAvailability(controller.signal)
      .then((res) => {
        if (!cancelled) {
          setMode(res.payosEnabled ? "payos" : "manual");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          if ((err as { name?: string })?.name === "AbortError") return;
          setMode("error");
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nonce]);

  return { mode, reload };
}

export const usePayosAvailability = useWalletTopUpMode;
