"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { WalletBalanceDto } from "@rescom/schemas";
import { getCurrentUser } from "../auth/auth-service.ts";
import { refreshSession, shouldRefreshBeforeLoad, startSessionRefreshScheduler } from "../auth/session-refresh.ts";
import type { AuthUser } from "../auth/types.ts";
import { getUnreadCount } from "../notifications/notification-service.ts";
import { getUserProfile, type UserProfile } from "../profile/profile-service.ts";
import { getWalletBalance } from "../wallet/wallet-service.ts";
import { sessionStatusAfterFailure, sessionStatusFromError, type SessionStatus } from "./session-status.ts";

export type { SessionStatus } from "./session-status.ts";

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  profile: UserProfile | null;
  balance: WalletBalanceDto | null;
  unreadCount: number;
  /** Name shown in the header/account; falls back to the email local part. */
  displayName: string;
  /** Re-fetch everything (after a mutation that moves points, etc.). */
  refresh: () => void;
  setUnreadCount: (count: number) => void;
}

const SessionContext = createContext<SessionState | null>(null);

interface AuthState {
  status: SessionStatus;
  user: AuthUser | null;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/**
 * App-wide signed-in context for the shell (points chip, bell badge, avatar),
 * mounted once by `app/(signed-in)/layout.tsx` for both route groups.
 * Screens fetch their own data; they call `refresh()` when points change.
 * While authenticated it keeps the access cookie fresh (`session-refresh.ts`).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading", user: null });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [balance, setBalance] = useState<WalletBalanceDto | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      // After a long idle the access cookie may be gone; `GET /auth/me` would then
      // 401 and drop the refresh cookie too, so rotate first. Failures fall through.
      if (shouldRefreshBeforeLoad()) await refreshSession().catch(() => undefined);
      if (signal.aborted) return;

      const me = await getCurrentUser(signal);
      if (signal.aborted) return;
      setAuth({ status: "authenticated", user: me });
      // Shell extras are best-effort: a failure leaves the chip/badge empty.
      const [wallet, count, userProfile] = await Promise.allSettled([
        getWalletBalance(signal),
        getUnreadCount(signal),
        getUserProfile(signal),
      ]);
      if (signal.aborted) return;
      if (wallet.status === "fulfilled") setBalance(wallet.value);
      if (count.status === "fulfilled") setUnreadCount(count.value);
      if (userProfile.status === "fulfilled") setProfile(userProfile.value);
    }

    load().catch((error: unknown) => {
      if (signal.aborted || isAbortError(error)) return;
      setAuth((current) => {
        const status = sessionStatusAfterFailure(current.status, error);
        return status === current.status && status === "authenticated" ? current : { status, user: null };
      });
    });
    return () => controller.abort();
  }, [version]);

  const authenticated = auth.status === "authenticated";
  useEffect(() => {
    if (!authenticated) return;
    // Stops on unmount and whenever the session ends (logout → 401, locked).
    return startSessionRefreshScheduler({
      onSessionEnded: (error) => setAuth({ status: sessionStatusFromError(error), user: null }),
    });
  }, [authenticated]);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  const value = useMemo<SessionState>(() => {
    const fallback = auth.user?.email.split("@")[0] ?? "";
    return {
      status: auth.status,
      user: auth.user,
      profile,
      balance,
      unreadCount,
      displayName: profile?.displayName?.trim() || fallback,
      refresh,
      setUnreadCount,
    };
  }, [auth, profile, balance, unreadCount, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>");
  return context;
}
