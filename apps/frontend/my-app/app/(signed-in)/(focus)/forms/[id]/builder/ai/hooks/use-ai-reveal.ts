"use client";

import { useCallback, useEffect, useState } from "react";
import { revealedAt } from "@/lib/forms/ai-reveal";

interface RevealRun {
  messageId: string;
  total: number;
  startedAt: number;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Types out the assistant answer that just landed (see `lib/forms/ai-reveal.ts`).
 * `messageId` is the answer being revealed and `shown` how many of its visible
 * characters are out; both reset once it is fully shown.
 */
export function useAiReveal() {
  const [run, setRun] = useState<RevealRun | null>(null);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!run) return;
    let frame = 0;
    const tick = () => {
      const next = revealedAt(performance.now() - run.startedAt, run.total);
      setShown(next);
      if (next >= run.total) setRun(null);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run]);

  const start = useCallback((messageId: string, total: number) => {
    if (total <= 0 || prefersReducedMotion()) return;
    setShown(0);
    setRun({ messageId, total, startedAt: performance.now() });
  }, []);

  /** Shows the whole answer now (a new prompt was sent). */
  const skip = useCallback(() => setRun(null), []);

  return { messageId: run?.messageId ?? null, shown, start, skip };
}
