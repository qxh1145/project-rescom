"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RedemptionErrorDto, RedemptionQuoteDto, RedemptionResultDto } from "@rescom/schemas";
import { useSession } from "@/lib/session/SessionProvider";
import { randomUuid } from "@/lib/random-uuid";
import { createRedemptionQuote, redeemVoucher, getRedemptionByKey } from "@/lib/rewards/rewards-service";
import { classifyRedeemFailure, pollRedemptionByKey, shouldSubmitRequote } from "@/lib/rewards/redeem-flow";

export type RedeemPhase = "closed" | "quoting" | "confirm" | "submitting" | "checking" | "success" | "rejected" | "failed";
export type RedeemState = { phase: RedeemPhase; quote: RedemptionQuoteDto | null; idempotencyKey: string; pollAttempt: number; pollExhausted: boolean; result: RedemptionResultDto | null; error: RedemptionErrorDto | null; failedKind: "failed" | "quoteNetwork" };
const initial: RedeemState = { phase: "closed", quote: null, idempotencyKey: "", pollAttempt: 0, pollExhausted: false, result: null, error: null, failedKind: "failed" };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
const isAbort = (error: unknown) => error instanceof Error && error.name === "AbortError";

export function useRedeemFlow({ voucherId, reloadAll }: { voucherId: string; reloadAll: () => void }) {
  const [state, setState] = useState<RedeemState>(initial);
  const stateRef = useRef(state);
  const controller = useRef<AbortController | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const { refresh } = useSession();
  const update = useCallback((patch: Partial<RedeemState>) => {
    if (!mounted.current) return;
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }, []);
  const newController = () => { controller.current?.abort(); controller.current = new AbortController(); return controller.current.signal; };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const submit = async (quote: RedemptionQuoteDto, key: string) => {
    if (locked.current) return;
    locked.current = true;
    const signal = newController();
    update({ phase: "submitting", quote, idempotencyKey: key, pollAttempt: 0, pollExhausted: false, error: null });
    try {
      const result = await redeemVoucher(quote.quoteId, key, signal);
      if (!signal.aborted) { update({ phase: "success", result }); refresh(); }
    } catch (err) {
      if (signal.aborted || isAbort(err)) return;
      const failure = classifyRedeemFailure(err);
      if (failure.kind === "rejected") {
        update({ phase: "rejected", error: failure.error });
        if (failure.error.code === "INSUFFICIENT_POINTS") refresh();
      } else if (failure.kind === "failed") update({ phase: "failed", failedKind: "failed" });
      else {
        update({ phase: "checking" });
        try {
          const outcome = await pollRedemptionByKey({ fetchByKey: (pollSignal) => getRedemptionByKey(key, pollSignal), sleep, onAttempt: (pollAttempt) => update({ pollAttempt }), signal });
          if (signal.aborted) return;
          if (outcome.kind === "succeeded") { update({ phase: "success", result: outcome.result }); refresh(); }
          else if (outcome.kind === "rejected") { update({ phase: "rejected", error: outcome.error }); if (outcome.error.code === "INSUFFICIENT_POINTS") refresh(); }
          else update({ pollExhausted: true });
        } catch (pollError) { if (!signal.aborted && !isAbort(pollError)) update({ pollExhausted: true }); }
      }
    } finally { if (controller.current?.signal === signal) locked.current = false; }
  };
  const open = () => {
    if (stateRef.current.phase !== "closed") return;
    // Safari/Firefox (macOS) do not focus a button on click; fall back to [data-redeem-cta] then.
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    const key = randomUuid();
    const signal = newController();
    update({ ...initial, phase: "quoting", idempotencyKey: key });
    void createRedemptionQuote(voucherId, signal).then((quote) => { if (!signal.aborted) update({ quote, phase: "confirm" }); }).catch((err) => {
      if (signal.aborted || isAbort(err)) return;
      const failure = classifyRedeemFailure(err);
      if (failure.kind === "rejected") { update({ phase: "rejected", error: failure.error }); if (failure.error.code === "INSUFFICIENT_POINTS") refresh(); }
      else update({ phase: "failed", failedKind: failure.kind === "unknown" ? "quoteNetwork" : "failed" });
    });
  };
  const confirm = () => { const { quote, idempotencyKey, phase } = stateRef.current; if (phase === "confirm" && quote) void submit(quote, idempotencyKey); };
  const requote = () => {
    const { error } = stateRef.current;
    const shownPoints = error?.code === "PRICE_CHANGED" ? error.details.price.points : null;
    const key = randomUuid();
    const signal = newController();
    update({ phase: "quoting", idempotencyKey: key, error: null, pollAttempt: 0, pollExhausted: false });
    void createRedemptionQuote(voucherId, signal).then((quote) => {
      if (signal.aborted) return;
      update({ quote, phase: "confirm" });
      if (shownPoints !== null && shouldSubmitRequote(shownPoints, quote)) void submit(quote, key);
    }).catch((err) => {
      if (signal.aborted || isAbort(err)) return;
      const failure = classifyRedeemFailure(err);
      if (failure.kind === "rejected") { update({ phase: "rejected", error: failure.error }); if (failure.error.code === "INSUFFICIENT_POINTS") refresh(); }
      else update({ phase: "failed", failedKind: failure.kind === "unknown" ? "quoteNetwork" : "failed" });
    });
  };
  const recheck = () => {
    const { quote, idempotencyKey, phase, pollExhausted } = stateRef.current;
    if (phase === "checking" && pollExhausted && quote) void submit(quote, idempotencyKey);
  };
  const close = () => {
    const { phase: current, pollExhausted } = stateRef.current;
    // While polling, a reopen would mint a new key before the first outcome is known.
    if (current === "closed" || current === "submitting" || (current === "checking" && !pollExhausted)) return;
    controller.current?.abort(); locked.current = false;
    update(initial);
    if (current !== "quoting" && current !== "confirm") reloadAll();
    if (current === "checking") refresh();
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) { opener.current.focus(); return; }
      const buttons = document.querySelectorAll<HTMLElement>("[data-redeem-cta]");
      [...buttons].find((button) => button.getClientRects().length > 0 && !button.hasAttribute("disabled"))?.focus();
    });
  };
  return { ...state, open, confirm, requote, recheck, close };
}
export type RedeemFlow = ReturnType<typeof useRedeemFlow>;
