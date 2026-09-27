"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import * as authService from "@/lib/auth/auth-service";
import { refreshSession, shouldRefreshBeforeLoad } from "@/lib/auth/session-refresh";

/**
 * `/login` and `/register` for a visitor who is already signed in: continue
 * where a fresh sign-in would (onboarding, `returnTo` or the Marketplace;
 * admins → console). The form stays visible meanwhile, so signed-out
 * visitors never wait on this check; any failure (401, locked…) keeps them here.
 */
export function useRedirectIfSignedIn(returnTo: string | null): void {
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function check() {
      // Same order as `SessionProvider`: a stale access cookie must not 401 and drop the refresh cookie.
      if (shouldRefreshBeforeLoad()) await refreshSession().catch(() => undefined);
      if (signal.aborted) return;
      const user = await authService.getCurrentUser(signal);
      const destination = await authService.resolvePostLoginDestination(returnTo, signal, user.role);
      if (!signal.aborted) router.replace(destination);
    }

    check().catch(() => undefined);
    return () => controller.abort();
  }, [returnTo, router]);
}
