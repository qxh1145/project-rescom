"use client";

import { useEffect, useState } from "react";
import { isApiMockingEnabled } from "@/lib/api/config";

let workerStart: Promise<void> | null = null;

/** Installs the in-page MSW interception once per page load; the module is never loaded when mocking is off. */
function startWorker(): Promise<void> {
  // Literal env check (not `isApiMockingEnabled`) so the bundler drops the MSW chunk when disabled.
  if (process.env.NEXT_PUBLIC_API_MOCKING !== "enabled") return Promise.resolve();
  workerStart ??= import("@/mocks/browser").then(({ startMocking }) => startMocking());
  return workerStart;
}

/**
 * With `NEXT_PUBLIC_API_MOCKING=enabled`, holds rendering until the mocks are
 * installed so no request can race past them. Otherwise renders children directly.
 */
export function MswProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!isApiMockingEnabled);

  useEffect(() => {
    if (ready) return;
    let active = true;
    startWorker()
      .catch((error: unknown) => {
        console.error("[MSW] Failed to start mocking; requests go to the network.", error);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [ready]);

  return ready ? children : null;
}
