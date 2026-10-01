"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { WalletBalanceDto } from "@rescom/schemas";
import { getCurrentUser } from "../auth/auth-service.ts";
import { getDemographics } from "../demographics/demographics-service.ts";
import {
  accessCookieMayBeExpired,
  refreshSession,
  shouldRefreshBeforeLoad,
  startSessionRefreshScheduler,
} from "../auth/session-refresh.ts";
import type { AuthUser } from "../auth/types.ts";
import { clearSessionReplaced } from "../auth/session-notice.ts";
import { getUnreadCount } from "../notifications/notification-service.ts";
import { getUserProfile, type UserProfile } from "../profile/profile-service.ts";
import { getWalletBalance } from "../wallet/wallet-service.ts";
import { onboardingStatusOf, type OnboardingStatus } from "./onboarding-gate.ts";
import {
  rateLimitRetryAfterSeconds,
  sessionStatusAfterFailure,
  sessionStatusFromError,
  withSessionRetry,
  type SessionStatus,
} from "./session-status.ts";

export type { SessionStatus } from "./session-status.ts";
export type { OnboardingStatus } from "./onboarding-gate.ts";

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  /** Set together with `authenticated`, so `SessionGate` never renders on a stale value. */
  onboarding: OnboardingStatus;
  profile: UserProfile | null;
  balance: WalletBalanceDto | null;
  unreadCount: number;
  /** Name shown in the header/account; falls back to the email local part. */
  displayName: string;
  /** Re-fetch everything (after a mutation that moves points, etc.). */
  refresh: () => void;
  setUnreadCount: (count: number) => void;
  /** Right after a successful onboarding submit, before `refresh()` confirms it. */
  markOnboardingComplete: () => void;
  /** `Retry-After` of the 429 behind `rate-limited`, for the `/rate-limited` countdown. */
  retryAfterSeconds: number | null;
}

const SessionContext = createContext<SessionState | null>(null);

interface AuthState {
  status: SessionStatus;
  user: AuthUser | null;
  onboarding: OnboardingStatus;
  retryAfterSeconds?: number | null;
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
  const [auth, setAuth] = useState<AuthState>({ status: "loading", user: null, onboarding: "unknown" });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [balance, setBalance] = useState<WalletBalanceDto | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      // After a long idle the access cookie may be gone; `GET /auth/me` would then
      // 401 and drop the refresh cookie too, so rotate first. Failures fall through,
      // except a 429 that outlasts its retries once the access cookie must have
      // expired: the load stops instead of risking that 401. A younger cookie is
      // still valid, so `GET /auth/me` goes ahead.
      if (shouldRefreshBeforeLoad()) {
        await withSessionRetry(() => refreshSession(), signal).catch((error: unknown) => {
          if (sessionStatusFromError(error) === "rate-limited" && accessCookieMayBeExpired()) throw error;
        });
      }
      if (signal.aborted) return;

      const [me, demographics] = await Promise.all([
        withSessionRetry(() => getCurrentUser(signal), signal),
        // Fails open (`unknown`): only `/auth/me` decides whether the session exists.
        getDemographics(signal).catch(() => null),
      ]);
      if (signal.aborted) return;
      // Signed in (again): an old "replaced" mark must not colour a later sign-out.
      clearSessionReplaced();
      setAuth((current) => ({
        status: "authenticated",
        user: me,
        // A failed re-read for the same user keeps the known status instead of opening the gate.
        onboarding:
          demographics === null && current.user?.id === me.id
            ? current.onboarding
            : onboardingStatusOf(me.role, demographics),
      }));
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
        return status === current.status && status === "authenticated"
          ? current
          : { status, user: null, onboarding: "unknown", retryAfterSeconds: rateLimitRetryAfterSeconds(error) };
      });
    });
    return () => controller.abort();
  }, [version]);

  const authenticated = auth.status === "authenticated";
  useEffect(() => {
    if (!authenticated) return;
    // Stops on unmount and whenever the session ends (logout → 401, locked).
    return startSessionRefreshScheduler({
      onSessionEnded: (error) => setAuth({ status: sessionStatusFromError(error), user: null, onboarding: "unknown" }),
    });
  }, [authenticated]);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);
  const markOnboardingComplete = useCallback(
    () =>
      setAuth((current) =>
        current.status === "authenticated" && current.onboarding === "incomplete"
          ? { ...current, onboarding: "complete" }
          : current,
      ),
    [],
  );

  const value = useMemo<SessionState>(() => {
    const fallback = auth.user?.email.split("@")[0] ?? "";
    return {
      status: auth.status,
      user: auth.user,
      onboarding: auth.onboarding,
      profile,
      balance,
      unreadCount,
      displayName: profile?.displayName?.trim() || fallback,
      refresh,
      setUnreadCount,
      markOnboardingComplete,
      retryAfterSeconds: auth.retryAfterSeconds ?? null,
    };
  }, [auth, profile, balance, unreadCount, refresh, markOnboardingComplete]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>");
  return context;
}
