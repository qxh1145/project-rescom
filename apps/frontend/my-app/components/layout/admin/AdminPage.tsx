"use client";

import type { ReactNode } from "react";
import { initialsOf } from "@/components/ui/Avatar";
import { useSession } from "@/lib/session/SessionProvider";

interface AdminPageProps {
  /** Page title (h1), e.g. "Tổng quan". */
  title: string;
  /** Muted text right of the title (date, counts…). */
  meta?: ReactNode;
  /** Controls right-aligned before the admin avatar (filters, export…). */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * One admin page: 73px header (Figma 62:4121 — 22px title, 14px muted meta,
 * 40px navy avatar) + content with 32px gutters (cards start at x=313 = 281 + 32).
 */
export function AdminPage({ title, meta, actions, children }: AdminPageProps) {
  const { displayName } = useSession();
  return (
    <>
      <header className="flex min-h-18.25 items-center gap-4.5 border-b border-line bg-surface px-8">
        <h1 className="text-title-sm font-extrabold text-ink">{title}</h1>
        {meta ? <p className="text-body-sm text-ink-muted">{meta}</p> : null}
        <div className="ml-auto flex items-center gap-3">
          {actions}
          <span
            aria-label={displayName ? `Admin ${displayName}` : "Admin"}
            role="img"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-body-sm font-extrabold text-white"
          >
            {initialsOf(displayName || "Admin")}
          </span>
        </div>
      </header>
      <main className="flex-1 px-8 pt-7 pb-10">{children}</main>
    </>
  );
}
