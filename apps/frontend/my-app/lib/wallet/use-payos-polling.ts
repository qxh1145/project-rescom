"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PayosTopUpDto } from "@rescom/schemas";
import { getPayosTopUp } from "./payos-top-up-service";
import { isTerminal, shouldPoll } from "./payos-top-up";

export type PollingState = "idle" | "polling" | "terminal" | "timed-out" | "error";

export interface UsePayosPollingResult {
  topUp: PayosTopUpDto | null;
  state: PollingState;
  recheck: () => void;
}

export function usePayosPolling(
  id: string | null,
  initialTopUp: PayosTopUpDto | null = null,
  onTerminal?: (topUp: PayosTopUpDto) => void,
): UsePayosPollingResult {
  const initialState = (
    forId: string | null,
    initial: PayosTopUpDto | null,
  ): PollingState => {
    if (!forId) return "idle";
    if (initial && isTerminal(initial.status)) return "terminal";
    if (initial && !shouldPoll(initial)) return "timed-out";
    return "polling";
  };
  const [topUp, setTopUp] = useState<PayosTopUpDto | null>(initialTopUp);
  const [state, setState] = useState<PollingState>(() => initialState(id, initialTopUp));
  const [lastId, setLastId] = useState(id);
  if (lastId !== id) {
    // Reset when the polled id changes so a stale terminal row never blocks the new id.
    setLastId(id);
    setTopUp(initialTopUp);
    setState(initialState(id, initialTopUp));
  }
  const topUpRef = useRef(topUp);
  useEffect(() => {
    topUpRef.current = topUp;
  }, [topUp]);

  const consecutiveErrorsRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onTerminalRef = useRef(onTerminal);

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  const fetchStatus = useCallback(async () => {
    if (!id) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const data = await getPayosTopUp(id, controller.signal);
      topUpRef.current = data;
      setTopUp(data);
      consecutiveErrorsRef.current = 0;

      if (isTerminal(data.status)) {
        setState("terminal");
        onTerminalRef.current?.(data);
        return;
      }

      if (!shouldPoll(data)) {
        setState("timed-out");
        return;
      }

      setState("polling");
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") return;
      consecutiveErrorsRef.current += 1;
      if (consecutiveErrorsRef.current >= 10) {
        setState("error");
      }
    }
  }, [id]);

  const recheck = useCallback(() => {
    consecutiveErrorsRef.current = 0;
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!id) return;

    let isSubscribed = true;

    const scheduleNext = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!isSubscribed || document.hidden) return; // Pause while tab hidden
      const current = topUpRef.current;
      if (current && (isTerminal(current.status) || !shouldPoll(current))) return;

      const delay = consecutiveErrorsRef.current >= 10 ? 10_000 : 3_000;
      timerRef.current = setTimeout(async () => {
        await fetchStatus();
        scheduleNext();
      }, delay);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        return;
      }
      const current = topUpRef.current;
      if (current && isTerminal(current.status)) return;
      void fetchStatus().then(scheduleNext);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleNext();

    return () => {
      isSubscribed = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      abortControllerRef.current?.abort();
    };
  }, [id, fetchStatus]);

  return {
    topUp,
    state,
    recheck,
  };
}
