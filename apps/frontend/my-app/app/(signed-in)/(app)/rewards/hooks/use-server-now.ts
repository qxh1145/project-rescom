"use client";

import { useEffect, useState } from "react";

/**
 * Single 1s interval per page providing server-offset time.
 * Automatically pauses when tab is hidden and recalculates on visibility change.
 */
export function useServerNow(offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) {
        setNow(Date.now() + offsetMs);
      }
    };

    // Re-sync at once when the offset changes (new serverTime), not a second later.
    tick();
    const interval = setInterval(tick, 1000);

    const onVisibilityChange = () => {
      if (!document.hidden) {
        setNow(Date.now() + offsetMs);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [offsetMs]);

  return now;
}
