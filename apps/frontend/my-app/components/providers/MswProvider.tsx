"use client";

import { useEffect, useState } from "react";
import { isApiMockingEnabled } from "@/lib/api/config";

let workerStart: Promise<void> | null = null;

/** Starts the MSW worker once per page load; the module is never loaded when mocking is off. */
function startWorker(): Promise<void> {
  // Literal env check (not `isApiMockingEnabled`) so the bundler drops the MSW chunk when disabled.
  if (process.env.NEXT_PUBLIC_API_MOCKING !== "enabled") return Promise.resolve();
  workerStart ??= import("@/mocks/browser").then(({ startMocking }) => startMocking());
  return workerStart;
}

/**
 * With `NEXT_PUBLIC_API_MOCKING=enabled`, holds rendering until the worker is
 * active so no request can race past it. Otherwise renders children directly.
 */
export function MswProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!isApiMockingEnabled);

  useEffect(() => {
    if (ready) return;
    let active = true;
    startWorker()
      .catch((error: unknown) => {
        console.error("[MSW] Failed to start the mock worker; requests go to the network.", error);
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
