"use client";

import { IconLink } from "@/components/ui/IconButton";
import { useSession } from "@/lib/session/SessionProvider";

/** Figma "Link – Thông báo, 3 chưa đọc" (62:966): 44px bell with a danger count badge. */
export function NotificationBellLink() {
  const { unreadCount } = useSession();
  const label = unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo";
  return (
    <IconLink href="/notifications" icon="bell" label={label}>
      {unreadCount > 0 ? (
        <span
          aria-hidden
          className="absolute left-4.75 top-1 inline-flex h-4.5 min-w-5.25 items-center justify-center rounded-[9px] border-2 border-surface bg-danger px-1 text-[10px] font-extrabold leading-none text-primary-foreground"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </IconLink>
  );
}
