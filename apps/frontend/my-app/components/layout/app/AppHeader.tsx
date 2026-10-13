"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RescomLogo } from "@/components/brand/RescomLogo";
import { Avatar, initialsOf } from "@/components/ui/Avatar";
import { useSession } from "@/lib/session/SessionProvider";
import { DESKTOP_NAV, isNavActive } from "./nav-items";
import { NotificationBellMenu } from "./NotificationBellMenu";
import { PointsChip } from "./PointsChip";

/**
 * Desktop header (≥ lg) — Figma "Header" 62:955: 73px, bottom border, 48px
 * gutters; active link is a #EAF6E8 pill with bold #1F6B2A text.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { displayName } = useSession();

  return (
    <header className="sticky top-0 z-30 hidden h-18.25 items-center border-b border-line bg-surface px-12 lg:flex">
      <Link href="/marketplace" aria-label="Rescom: Khám phá" className="mr-10 shrink-0">
        <RescomLogo size="md" />
      </Link>
      <nav aria-label="Điều hướng chính" className="flex items-center gap-1.5">
        {DESKTOP_NAV.map((item) => {
          const active = isNavActive(item, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={[
                "inline-flex h-10 items-center rounded-[10px] px-4 text-body transition-colors",
                active ? "bg-tone-green-bg font-bold text-primary-strong" : "font-semibold text-ink hover:bg-surface-subtle",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <PointsChip variant="desktop" />
        <NotificationBellMenu />
        <Link href="/account" aria-label="Tài khoản" className="rounded-full">
          <Avatar initials={initialsOf(displayName || "?")} />
        </Link>
      </div>
    </header>
  );
}
