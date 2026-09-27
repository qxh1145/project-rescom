"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Spinner } from "@/components/ui/Spinner";
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
 * `/login?error=AUTH_USER_LOCKED`, no connection → `/offline?from=…`, anything
 * else → `/server-error?from=…`. Non-admins on admin pages go to `/forbidden`.
 * The backend still enforces access; this only avoids rendering a shell
 * that can load nothing.
 */
export function SessionGate({ children, requireAdmin = false }: SessionGateProps) {
  const { status, user } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status === "authenticated") {
      if (requireAdmin && user?.role !== "ADMIN") router.replace("/forbidden");
      return;
    }
    const query = searchParams.toString();
    const target = sessionGateRedirect(status, `${pathname}${query ? `?${query}` : ""}`);
    if (target) router.replace(target);
  }, [status, user, requireAdmin, router, pathname, searchParams]);

  if (status === "authenticated" && (!requireAdmin || user?.role === "ADMIN")) return <>{children}</>;
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center text-primary">
      <Spinner className="size-6" />
      <span className="sr-only">Đang tải…</span>
    </div>
  );
}
