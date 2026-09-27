"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { NOTIFICATION_MESSAGES } from "@/lib/notifications/notification-messages";
import {
  groupNotifications,
  notificationPresentation,
  notificationText,
  notificationTimeLabel,
  type NotificationTone,
} from "@/lib/notifications/notification-presentation";
import type { NotificationItem } from "@/lib/notifications/notification-service";
import type { NotificationFeed as Feed, NotificationFilter } from "@/lib/notifications/use-notification-feed";

/**
 * Figma 14d "Thông báo": shared by the desktop header panel (62:1862) and
 * `/notifications` (62:2117). Pieces are exported separately because the
 * mobile page puts "Đánh dấu đã đọc" in its back bar.
 */

const TILE: Record<NotificationTone, string> = {
  green: "bg-tone-green-bg text-tone-green-fg",
  teal: "bg-tone-teal-bg text-tone-teal-fg",
  amber: "bg-tone-amber-bg text-tone-amber-fg",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-subtle text-ink-muted",
};

/** "Đánh dấu đã đọc" (62:1865): 14px bold primary text button. */
export function MarkAllReadButton({ feed }: { feed: Feed }) {
  const disabled = feed.unreadCount === 0 || feed.markingAll;
  return (
    <button
      type="button"
      onClick={() => void feed.markAllRead()}
      disabled={disabled}
      aria-busy={feed.markingAll || undefined}
      className="inline-flex min-h-11 shrink-0 items-center rounded-field px-1 text-label font-bold text-primary transition-colors hover:text-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      Đánh dấu đã đọc
    </button>
  );
}

/** "Button – Tất cả" / "Button – Chưa đọc · 3" (62:1866/62:1868): 36px pills; active = ink fill. */
export function NotificationFilters({ feed }: { feed: Feed }) {
  const options: { value: NotificationFilter; label: string }[] = [
    { value: "all", label: "Tất cả" },
    { value: "unread", label: `Chưa đọc · ${feed.unreadCount}` },
  ];
  return (
    <div role="group" aria-label="Lọc thông báo" className="flex gap-2">
      {options.map((option) => {
        const active = feed.filter === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => feed.changeFilter(option.value)}
            className={[
              "inline-flex h-9 items-center rounded-full px-4 text-label transition-colors",
              active
                ? "bg-ink font-bold text-primary-foreground"
                : "border border-line-strong bg-surface font-semibold text-ink hover:bg-surface-subtle",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface RowProps {
  item: NotificationItem;
  now: Date;
  onOpen: (item: NotificationItem) => void;
}

/** "Link – Khiếu nại được chấp nhận" (62:2132): 40px tile, title + time, body, unread dot. */
function NotificationRow({ item, now, onOpen }: RowProps) {
  const { icon, tone, href } = notificationPresentation(item.type, item.message);
  const { title, body } = notificationText(item);
  const unread = !item.isRead;
  const className = [
    "flex w-full gap-3 border-b border-line-subtle px-4 pt-3.5 pb-4 text-left transition-colors",
    unread ? "bg-tone-green-tint hover:bg-tone-green-bg" : "bg-surface hover:bg-surface-muted",
  ].join(" ");
  const content = (
    <>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-field ${TILE[tone]}`}>
        <Icon name={icon} size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-start justify-between gap-2">
          <span className={`text-body text-ink ${unread ? "font-extrabold" : "font-bold"}`}>{title}</span>
          <span className="mt-0.5 shrink-0 text-[12px] text-ink-muted">{notificationTimeLabel(item.createdAt, now)}</span>
        </span>
        {body ? <span className="text-caption-relaxed text-ink-strong">{body}</span> : null}
      </span>
      <span className="w-2.5 shrink-0 pt-1.5">
        {unread ? (
          <>
            <span aria-hidden className="block size-2.5 rounded-full bg-primary" />
            <span className="sr-only">Chưa đọc</span>
          </>
        ) : null}
      </span>
    </>
  );

  return (
    <li>
      {href ? (
        <Link href={href} onClick={() => onOpen(item)} className={className}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={() => onOpen(item)} className={className}>
          {content}
        </button>
      )}
    </li>
  );
}

interface NotificationListProps {
  feed: Feed;
  /** Called after a row was chosen (the panel closes; navigation is the row's link). */
  onNavigate?: () => void;
  /** Rows shown at most (the panel shows the latest few). */
  max?: number;
  /** Show "Tải thêm" when the API has more (page only). */
  paged?: boolean;
}

/** Grouped list ("HÔM NAY" / "TRƯỚC ĐÓ") with loading, error and empty states. */
export function NotificationList({ feed, onNavigate, max, paged = false }: NotificationListProps) {
  const [now] = useState(() => new Date());
  const idPrefix = useId();
  const { list, error } = feed;

  if (error && !list) {
    return (
      <div className="p-4">
        <Alert tone="danger">
          {NOTIFICATION_MESSAGES.loadFailed}{" "}
          <Button variant="ghost" size="sm" className="-my-2 inline-flex" onClick={feed.reload}>
            Thử lại
          </Button>
        </Alert>
      </div>
    );
  }
  if (!list) {
    return (
      <p role="status" className="flex items-center justify-center gap-3 py-10 text-body text-ink-muted">
        <Spinner className="size-5 text-primary" />
        Đang tải…
      </p>
    );
  }

  const items = max === undefined ? list.items : list.items.slice(0, max);
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-surface-subtle text-ink-muted">
          <Icon name="bell" size={22} />
        </span>
        <p className="text-body text-ink-muted">
          {feed.filter === "unread" ? NOTIFICATION_MESSAGES.emptyUnread : NOTIFICATION_MESSAGES.emptyAll}
        </p>
      </div>
    );
  }

  const open = (item: NotificationItem) => {
    void feed.markRead(item);
    if (notificationPresentation(item.type, item.message).href) onNavigate?.();
  };

  return (
    <>
      {feed.actionError ? (
        <div className="px-4 py-2">
          <Alert tone="danger">{feed.actionError}</Alert>
        </div>
      ) : null}
      {error ? (
        // A reload failed: the list already shown stays, with the error above it.
        <div className="px-4 py-2">
          <Alert tone="danger">
            {NOTIFICATION_MESSAGES.loadFailed}{" "}
            <Button variant="ghost" size="sm" className="-my-2 inline-flex" onClick={feed.reload}>
              Thử lại
            </Button>
          </Alert>
        </div>
      ) : null}
      {groupNotifications(items, now).map((group) => (
        <section key={group.key} aria-labelledby={`${idPrefix}-${group.key}`}>
          <h3
            id={`${idPrefix}-${group.key}`}
            className="bg-surface-muted px-4 pt-3.5 pb-1.5 text-[12px] font-bold tracking-[0.5px] text-ink-muted"
          >
            {group.label}
          </h3>
          <ul>
            {group.items.map((item) => (
              <NotificationRow key={item.id} item={item} now={now} onOpen={open} />
            ))}
          </ul>
        </section>
      ))}
      {paged && feed.canLoadMore ? (
        <div className="flex flex-col items-center gap-3 p-4">
          {feed.loadMoreFailed ? (
            <Alert tone="danger" className="w-full">
              {NOTIFICATION_MESSAGES.loadMoreFailed}
            </Alert>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => void feed.loadMore()} loading={feed.loadingMore}>
            Tải thêm
          </Button>
        </div>
      ) : null}
    </>
  );
}
