"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  THOUGHT_SLOW_AFTER_MS,
  activeStepAt,
  type SavedThought,
  type ThoughtStatus,
  type ThoughtStep,
} from "@/lib/forms/ai-thinking";

interface ThoughtRun {
  steps: ThoughtStep[];
  status: ThoughtStatus;
  startedAt: number;
  endedAt: number | null;
  /** The assistant message this run produced (done runs only). */
  messageId: string | null;
}

export interface AiThinkingView {
  steps: ThoughtStep[];
  status: ThoughtStatus;
  /** Index of the active step; `steps.length` once nothing is active. */
  activeIndex: number;
  seconds: number;
  /** Running for longer than `THOUGHT_SLOW_AFTER_MS`. */
  slow: boolean;
  messageId: string | null;
}

/**
 * Clock of the thought line: paces the planned steps while a request runs,
 * then keeps the finished (or stopped) run to show collapsed above its answer.
 */
export function useAiThinking() {
  const [run, setRun] = useState<ThoughtRun | null>(null);
  const [now, setNow] = useState(0);
  const running = run?.status === "running";
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    timer.current = setInterval(() => setNow(Date.now()), 250);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [running]);

  const start = useCallback((steps: ThoughtStep[]) => {
    const at = Date.now();
    startedAtRef.current = at;
    setNow(at);
    setRun({ steps, status: "running", startedAt: at, endedAt: null, messageId: null });
  }, []);

  /** Marks the run done with the filled-in steps; returns how long it took (seconds). */
  const finish = useCallback((steps: ThoughtStep[], messageId: string | null): number => {
    const at = Date.now();
    setRun((current) => (current ? { ...current, steps, status: "done", endedAt: at, messageId } : null));
    return (at - startedAtRef.current) / 1000;
  }, []);

  const stop = useCallback(() => {
    const at = Date.now();
    setRun((current) => (current && current.status === "running" ? { ...current, status: "stopped", endedAt: at } : current));
  }, []);

  const clear = useCallback(() => setRun(null), []);

  /** Restores a run finished before a navigation (see `saveThought`). */
  const restore = useCallback((saved: SavedThought) => {
    setRun({ steps: saved.steps, status: saved.status, startedAt: 0, endedAt: saved.seconds * 1000, messageId: saved.messageId });
  }, []);

  let view: AiThinkingView | null = null;
  if (run) {
    const end = run.endedAt ?? Math.max(now, run.startedAt);
    const elapsed = end - run.startedAt;
    view = {
      steps: run.steps,
      status: run.status,
      // A stopped run keeps the step it was on (shown unfinished, no longer animating).
      activeIndex: run.status === "done" ? run.steps.length : activeStepAt(elapsed, run.steps.length),
      seconds: elapsed / 1000,
      slow: run.status === "running" && elapsed > THOUGHT_SLOW_AFTER_MS,
      messageId: run.messageId,
    };
  }

  return { view, start, finish, stop, clear, restore };
}
