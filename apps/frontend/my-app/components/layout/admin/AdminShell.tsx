"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Suspense, useContext, useMemo, type ReactNode } from "react";
import { RescomLogo } from "@/components/brand/RescomLogo";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { getAdminQueueCounts, type AdminQueueCounts } from "@/lib/admin/admin-queue-service";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useLogout } from "@/lib/auth/use-logout";
import { useSession } from "@/lib/session/SessionProvider";
import { SessionGate } from "../app/SessionGate";
import { ADMIN_NAV, isAdminNavActive } from "./admin-nav";

interface AdminCountsValue {
  counts: AdminQueueCounts | undefined;
  /** Call after an action that changes a queue (approve, reject, resolve…). */
  refreshCounts: () => void;
}

const AdminCountsContext = createContext<AdminCountsValue>({ counts: undefined, refreshCounts: () => {} });

/** Sidebar badge counts + refresh, for admin pages that change a queue. */
export function useAdminCounts(): AdminCountsValue {
  return useContext(AdminCountsContext);
}

/**
 * Admin console frame (Figma 11, desktop only): 281px sidebar (62:4071) +
 * content column. Each page renders its own header with `AdminPage`.
 * Admin-only: `SessionGate requireAdmin` sends other roles to `/forbidden`;
 * the backend still enforces the ADMIN role on every `/admin/*` route.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <SessionGate requireAdmin>
        <AdminFrame>{children}</AdminFrame>
      </SessionGate>
    </Suspense>
  );
}

function AdminFrame({ children }: { children: ReactNode }) {
  const query = useApiQuery("admin:queue-counts", (signal) => getAdminQueueCounts(signal));
  const { data, reload } = query;
  const value = useMemo(() => ({ counts: data, refreshCounts: reload }), [data, reload]);

  return (
    <AdminCountsContext.Provider value={value}>
      {/* ASSUMED (design): the console is drawn at 1440 only; below lg the sidebar stacks on top. */}
      <div className="flex min-h-dvh flex-col bg-surface-muted lg:flex-row">
        <AdminSidebar counts={data} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </AdminCountsContext.Provider>
  );
}

function AdminSidebar({ counts }: { counts: AdminQueueCounts | undefined }) {
  const pathname = usePathname();
  return (
    <aside className="flex shrink-0 flex-col border-b border-line bg-surface lg:sticky lg:top-0 lg:h-dvh lg:w-70.25 lg:border-r lg:border-b-0">
      <div className="flex items-center gap-2 px-6 pt-6">
        <Link href="/admin" aria-label="Rescom Admin — Tổng quan">
          {/* Figma logo is 26px high; `sm` (24px) is the closest shared size. */}
          <RescomLogo size="sm" />
        </Link>
        <span className="inline-flex h-5.5 items-center rounded-full bg-ink px-2 text-[11px] font-extrabold tracking-[0.4px] text-white">
          ADMIN
        </span>
      </div>
      <nav aria-label="Điều hướng quản trị" className="flex gap-1 overflow-x-auto px-4 pt-6 pb-4 lg:flex-col">
        {ADMIN_NAV.map((item) => {
          const active = isAdminNavActive(item, pathname);
          const count = item.queue ? counts?.[item.queue] : undefined;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={[
                "flex h-11 shrink-0 items-center gap-2.5 rounded-[10px] px-3 text-body transition-colors",
                active ? "bg-tone-green-bg font-bold text-primary-strong" : "font-semibold text-ink hover:bg-surface-subtle",
              ].join(" ")}
            >
              <Icon name={item.icon} size={20} />
              <span className="whitespace-nowrap">{item.label}</span>
              {count ? (
                <span className="ml-auto inline-flex size-5.5 items-center justify-center rounded-full bg-danger text-[12px] font-extrabold text-white">
                  <span className="sr-only">, </span>
                  {count > 99 ? "99+" : count}
                  <span className="sr-only"> đang chờ</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <AdminAccount />
    </aside>
  );
}

/**
 * ASSUMED (design): Figma 11 draws no account block; the admin's email and "Đăng xuất"
 * sit at the bottom of the sidebar (a row under the nav below lg).
 */
function AdminAccount() {
  const { user } = useSession();
  const { signOut, pending, error, dismissError } = useLogout();
  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-4 lg:mt-auto">
      {error ? (
        <Alert tone="danger" onDismiss={dismissError}>
          {error}
        </Alert>
      ) : null}
      <div className="flex items-center gap-2.5">
        <p className="min-w-0 flex-1 truncate px-2 text-body-sm text-ink-muted" title={user?.email}>
          {user?.email}
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={pending}
          aria-busy={pending || undefined}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] px-3 text-body font-semibold text-danger transition-colors hover:bg-surface-subtle disabled:opacity-60"
        >
          <Icon name="log-out" size={20} />
          {pending ? "Đang đăng xuất…" : "Đăng xuất"}
        </button>
      </div>
    </div>
  );
}
