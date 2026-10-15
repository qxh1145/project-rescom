"use client";

import { useEffect, useRef } from "react";
import {
  countdownAnnouncement,
  countdownMinuteKey,
  remaining,
} from "@/lib/rewards/server-clock";

interface CountdownProps {
  endsAt: string;
  nowMs: number;
  kind?: "ends" | "starts";
  tone?: "default" | "onBrand";
  onElapsed?: () => void;
  className?: string;
}

export function Countdown({
  endsAt,
  nowMs,
  kind = "ends",
  tone = "default",
  onElapsed,
  className = "",
}: CountdownProps) {
  const { totalSeconds, hh, mm, ss } = remaining(endsAt, nowMs);
  // The endsAt we already fired for: one call per target, re-armed when time is positive again.
  const elapsedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (totalSeconds > 0) {
      elapsedForRef.current = null;
    } else if (elapsedForRef.current !== endsAt) {
      elapsedForRef.current = endsAt;
      onElapsed?.();
    }
  }, [totalSeconds, endsAt, onElapsed]);

  // The announcement is derived from the minute key alone, so its text (and the
  // live region) only changes when the minute changes.
  const announcement = countdownAnnouncement(countdownMinuteKey(totalSeconds) * 60, kind);

  const boxClass =
    tone === "onBrand"
      ? "bg-white/15 text-white font-mono font-bold text-sm px-1.5 py-0.5 rounded-[6px]"
      : "bg-surface-subtle text-ink font-mono font-bold text-sm px-1.5 py-0.5 rounded-[6px]";
  const colonClass = tone === "onBrand" ? "text-white/80 font-bold" : "text-ink-muted font-bold";

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      {/* Visual digits (aria-hidden) */}
      <div aria-hidden="true" className="flex items-center gap-1">
        <span className={boxClass}>{hh}</span>
        <span className={colonClass}>:</span>
        <span className={boxClass}>{mm}</span>
        <span className={colonClass}>:</span>
        <span className={boxClass}>{ss}</span>
      </div>

      {/* Screen reader announcement, changes only when minute changes */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
