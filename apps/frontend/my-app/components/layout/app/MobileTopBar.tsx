"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { RescomLogo } from "@/components/brand/RescomLogo";
import { IconButton, IconLink } from "@/components/ui/IconButton";
import { NotificationBellLink } from "./NotificationBellLink";
import { PointsChip } from "./PointsChip";

/**
 * Mobile headers (< lg). Figma draws them under a 44px status bar; here the
 * safe-area inset stands in for it.
 */

const BAR_BASE = "sticky top-0 z-30 bg-surface pt-[max(env(safe-area-inset-top),8px)]";
const BAR = `${BAR_BASE} lg:hidden`;

/** "Header" 62:1251 — logo, points chip, bell (Khám phá). */
export function MobileBrandBar() {
  return (
    <header className={BAR}>
      <div className="flex h-15 items-center gap-2.5 px-5">
        <Link href="/marketplace" aria-label="Rescom: Khám phá" className="mr-auto">
          <RescomLogo size="sm" />
        </Link>
        <PointsChip variant="mobile" />
        <NotificationBellLink />
      </div>
    </header>
  );
}

/** "Header" 62:1053 — large page title + bell (Ví điểm, Tài khoản). */
export function MobileTitleBar({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className={BAR}>
      <div className="flex h-15 items-center gap-2.5 px-5">
        <h1 className="mr-auto text-[24px] font-extrabold tracking-[-0.5px] text-ink">{title}</h1>
        {action ?? <NotificationBellLink />}
      </div>
    </header>
  );
}

interface MobileBackBarProps {
  title: ReactNode;
  /** Link target; omit to go back in history. */
  backHref?: string;
  backLabel?: string;
  /** Right-side slot (e.g. "Đánh dấu đã đọc", reward pill). */
  action?: ReactNode;
  /** Secondary line under the title (survey headers: "Google Forms · 8 phút"). */
  subtitle?: ReactNode;
  bordered?: boolean;
  /** Render at every breakpoint (focused flows without the desktop header). */
  alwaysVisible?: boolean;
}

/** "Header" 62:2807 — 44px back button + 18px extra-bold title. */
export function MobileBackBar({
  title,
  backHref,
  backLabel = "Quay lại",
  action,
  subtitle,
  bordered = true,
  alwaysVisible = false,
}: MobileBackBarProps) {
  const router = useRouter();
  return (
    <header
      className={`${alwaysVisible ? BAR_BASE : BAR} ${bordered ? "border-b border-line" : ""}`}
    >
      <div className="flex min-h-15 items-center gap-3 px-4 pb-2">
        {backHref ? (
          <IconLink href={backHref} icon="chevron-left" label={backLabel} />
        ) : (
          <IconButton icon="chevron-left" label={backLabel} onClick={() => router.back()} />
        )}
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-[18px] font-extrabold text-ink">{title}</h1>
          {subtitle ? <p className="truncate text-caption text-ink-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
    </header>
  );
}
