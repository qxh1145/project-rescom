"use client";

import { useEffect } from "react";
import { useSession } from "./SessionProvider.tsx";
import { isSessionLost } from "./session-status.ts";

/**
 * Hands a lost session (401 / AUTH_USER_LOCKED on a data request) to
 * `SessionGate`: re-checks the session once, which then redirects to login.
 * Local drafts are left untouched. Returns true while that happens so the
 * screen can keep a loading state instead of an error.
 */
export function useSessionLossRedirect(...errors: unknown[]): boolean {
  const { refresh } = useSession();
  const lost = errors.some(isSessionLost);
  useEffect(() => {
    if (lost) refresh();
  }, [lost, refresh]);
  return lost;
}
