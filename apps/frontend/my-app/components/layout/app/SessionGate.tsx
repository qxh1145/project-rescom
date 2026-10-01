"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { onboardingGateRedirect } from "@/lib/session/onboarding-gate";
import { useSession } from "@/lib/session/SessionProvider";
import { sessionGateRedirect } from "@/lib/session/session-status";

interface SessionGateProps {
  children: ReactNode;
  /** Only admins may see the content (admin console). */
  requireAdmin?: boolean;
}

/**
 * Client-side guard for signed-in areas. A failed session check is routed by
 * cause (`sessionGateRedirect`): 401 → `/login?returnTo=…`, locked account →
 * `/login?error=AUTH_USER_LOCKED`, no connection → `/offline?from=…`, 429
 * after its retries → `/rate-limited?from=…`, anything else →
 * `/server-error?from=…`. Non-admins on admin pages go to `/forbidden`.
 * Outside the admin console, a respondent who has not finished onboarding is
 * sent to `/onboarding?required=1&returnTo=…` (`onboardingGateRedirect`).
 * The backend still enforces access; this only avoids rendering a shell
 * that can load nothing.
 */
export function SessionGate({ children, requireAdmin = false }: SessionGateProps) {
  const { status, user, onboarding, retryAfterSeconds } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const currentPath = `${pathname}${query ? `?${query}` : ""}`;

  const authenticated = status === "authenticated";
  const forbidden = authenticated && requireAdmin && user?.role !== "ADMIN";
  const onboardingTarget =
    authenticated && !requireAdmin
      ? onboardingGateRedirect({ role: user?.role, onboarding, pathname, currentPath })
      : null;

  useEffect(() => {
    if (forbidden) router.replace("/forbidden");
    else if (onboardingTarget) router.replace(onboardingTarget);
    else if (!authenticated) {
      const target = sessionGateRedirect(status, currentPath, retryAfterSeconds);
      if (target) router.replace(target);
    }
  }, [authenticated, forbidden, onboardingTarget, status, currentPath, retryAfterSeconds, router]);

  if (authenticated && !forbidden && !onboardingTarget) return <>{children}</>;
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center text-primary">
      <Spinner className="size-6" />
      <span className="sr-only">Đang tải…</span>
    </div>
  );
}
