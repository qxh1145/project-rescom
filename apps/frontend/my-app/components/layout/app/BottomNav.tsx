"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { MOBILE_NAV, isNavActive } from "./nav-items";

/**
 * Mobile tab bar (< lg) — Figma "Nav" 62:1359: 84px with top border; 22px
 * icon over an 11px label; active = primary + bold.
 */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex h-15.5 max-w-120">
        {MOBILE_NAV.map((item) => {
          const active = isNavActive(item, pathname);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex h-full flex-col items-center justify-center gap-1 text-[11px]",
                  active ? "font-bold text-primary" : "font-semibold text-ink-muted",
                ].join(" ")}
              >
                <Icon name={item.icon} size={22} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
