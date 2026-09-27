"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { useNotificationFeed } from "@/lib/notifications/use-notification-feed";
import { useSession } from "@/lib/session/SessionProvider";
import { bellLabel, UnreadBadge } from "./NotificationBellLink";
import { MarkAllReadButton, NotificationFilters, NotificationList } from "./NotificationFeed";

/** ASSUMED: the panel lists the latest 6 (what 62:1862 draws); the rest is on `/notifications`. */
const PANEL_ITEMS = 6;

/**
 * Desktop bell (Figma 14d 62:1837): toggles the notification panel under the
 * header; closes on outside click, Escape, focus leaving it (Tab past the
 * end) and after choosing a row. Opening moves focus to the panel heading.
 */
export function NotificationBellMenu() {
  const { unreadCount } = useSession();
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  const titleId = useId();
  const feed = useNotificationFeed({ pageSize: PANEL_ITEMS, enabled: open, instance });

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      bellRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Screen reader and keyboard users land in the panel, starting at its title.
    titleRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      // A fresh list on every open.
      setInstance((current) => current + 1);
      feed.changeFilter("all");
    }
    setOpen(!open);
  };

  // Keyboard focus moved outside the bell + panel (e.g. Tab past the last row): close.
  const closeOnFocusLeave = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !containerRef.current?.contains(next)) setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative" onBlur={closeOnFocusLeave}>
      <IconButton
        ref={bellRef}
        icon="bell"
        label={bellLabel(unreadCount)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={toggle}
        className={open ? "bg-ink! text-primary-foreground! hover:bg-ink!" : ""}
      >
        <UnreadBadge count={unreadCount} />
      </IconButton>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className="absolute top-16.75 -right-1 z-40 flex max-h-[calc(100dvh-96px)] w-110.5 flex-col overflow-hidden rounded-[20px] border border-line bg-surface shadow-[0_20px_44px_rgba(30,36,70,0.2)]"
        >
          <div className="shrink-0 border-b border-line px-4 pt-4 pb-[13px]">
            <div className="flex items-center justify-between gap-3">
              <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-[18px] font-extrabold text-ink outline-none">
                Thông báo
              </h2>
              <MarkAllReadButton feed={feed} />
            </div>
            <div className="mt-3">
              <NotificationFilters feed={feed} />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NotificationList feed={feed} max={PANEL_ITEMS} onNavigate={close} />
          </div>
          <Link
            href="/notifications"
            onClick={close}
            className="flex h-13.25 shrink-0 items-center justify-center border-t border-line text-label font-bold text-primary hover:bg-surface-muted"
          >
            Xem tất cả thông báo
          </Link>
        </div>
      ) : null}
    </div>
  );
}
