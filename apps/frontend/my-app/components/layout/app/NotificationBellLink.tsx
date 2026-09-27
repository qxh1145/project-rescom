"use client";

import { IconLink } from "@/components/ui/IconButton";
import { useSession } from "@/lib/session/SessionProvider";

export function bellLabel(unreadCount: number): string {
  return unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo";
}

/** Danger count badge of the bell (62:1853): 18px, 2px white ring. */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className="absolute left-4.75 top-1 inline-flex h-4.5 min-w-5.25 items-center justify-center rounded-[9px] border-2 border-surface bg-danger px-1 text-[10px] font-extrabold leading-none text-primary-foreground"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Figma "Link – Thông báo, 3 chưa đọc" (62:966): 44px bell linking to
 * `/notifications` (mobile headers). The desktop header opens the panel
 * instead (`NotificationBellMenu`).
 */
export function NotificationBellLink() {
  const { unreadCount } = useSession();
  return (
    <IconLink href="/notifications" icon="bell" label={bellLabel(unreadCount)}>
      <UnreadBadge count={unreadCount} />
    </IconLink>
  );
}
