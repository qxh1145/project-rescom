"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { NotificationDto } from "@rescom/schemas";
import {
  mockRepository,
  NOTIFICATIONS_CHANGED_EVENT,
} from "@/lib/mock/repository.ts";
import { getNotificationPresentation } from "@/lib/notification-presentation.ts";

const RECENT_LIMIT = 10;

type Filter = "all" | "unread";
type ListStatus = "idle" | "loading" | "ready" | "error";

const relativeTimeFormat = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });

function formatRelativeTime(isoDate: string, now: number): string {
  const diffSeconds = Math.round((new Date(isoDate).getTime() - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return "Vừa xong";
  if (abs < 3600) return relativeTimeFormat.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return relativeTimeFormat.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 7 * 86400) return relativeTimeFormat.format(Math.round(diffSeconds / 86400), "day");
  return new Date(isoDate).toLocaleDateString("vi-VN");
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : "Không thể tải thông báo. Vui lòng thử lại.";
}

/**
 * Header notification bell (Story 9.6, FR-57): unread badge plus a panel of
 * recent notifications with mark-as-read. Data comes from the mock-first
 * repository; all read-state rules live there.
 */
export function NotificationBell() {
  const router = useRouter();
  const panelId = useId();
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [status, setStatus] = useState<ListStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Ignores out-of-order responses when the filter changes quickly.
  const latestRequestRef = useRef(0);
  // True while the panel shows a successfully loaded list.
  const hasListRef = useRef(false);

  const refreshCount = useCallback(async () => {
    try {
      setUnreadCount(await mockRepository.getUnreadNotificationCount());
    } catch {
      // The badge keeps its last known value; the panel surfaces errors.
    }
  }, []);

  const loadList = useCallback(
    async (activeFilter: Filter, options: { silent?: boolean } = {}) => {
      const requestId = ++latestRequestRef.current;
      if (!options.silent) {
        hasListRef.current = false;
        setStatus("loading");
        setError(null);
      }
      try {
        const result = await mockRepository.getNotifications({
          limit: RECENT_LIMIT,
          unreadOnly: activeFilter === "unread",
        });
        if (requestId !== latestRequestRef.current) return;
        setItems(result.items);
        setUnreadCount(result.unreadCount);
        setNow(Date.now());
        hasListRef.current = true;
        setStatus("ready");
      } catch (err) {
        if (requestId !== latestRequestRef.current) return;
        // A silent refresh that overtook a visible load must not leave the
        // skeleton on screen; it only stays quiet over an already shown list.
        if (!options.silent || !hasListRef.current) {
          setError(errorMessage(err));
          setStatus("error");
        }
      }
    },
    [],
  );

  // Latest panel state for the long-lived window listeners below and for
  // handlers that resume after an await (the user may have switched tabs).
  const panelStateRef = useRef({ isOpen, filter });
  useEffect(() => {
    panelStateRef.current = { isOpen, filter };
  }, [isOpen, filter]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Initial badge + refresh whenever demo data changes or the tab regains focus.
  useEffect(() => {
    let active = true;
    async function loadInitialCount() {
      try {
        const count = await mockRepository.getUnreadNotificationCount();
        if (active) setUnreadCount(count);
      } catch {
        // Badge stays hidden; opening the panel surfaces the error.
      }
    }
    const handleChange = () => {
      const { isOpen: open, filter: activeFilter } = panelStateRef.current;
      if (open) {
        void loadList(activeFilter, { silent: true });
      } else {
        void refreshCount();
      }
    };

    void loadInitialCount();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handleChange);
    window.addEventListener("focus", handleChange);
    return () => {
      active = false;
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, handleChange);
      window.removeEventListener("focus", handleChange);
    };
  }, [refreshCount, loadList]);

  const close = useCallback((returnFocus: boolean) => {
    setIsOpen(false);
    setActionError(null);
    if (returnFocus) {
      bellRef.current?.focus();
    }
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        close(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen, close]);

  function openPanel() {
    setIsOpen(true);
    void loadList(filter);
    // Move focus into the panel once it has rendered.
    requestAnimationFrame(() => panelRef.current?.focus());
  }

  function handleToggle() {
    if (isOpen) {
      close(false);
    } else {
      openPanel();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && isOpen) {
      event.stopPropagation();
      close(true);
    }
  }

  function handleFilterChange(next: Filter) {
    if (next === filter) return;
    setFilter(next);
    void loadList(next);
  }

  async function handleItemClick(notification: NotificationDto) {
    setActionError(null);
    if (!notification.isRead) {
      try {
        const result = await mockRepository.markNotificationRead(notification.id);
        setUnreadCount(result.unreadCount);
        const activeFilter = panelStateRef.current.filter;
        // Computed from the ref (kept in sync here, not only after render) so
        // two quick clicks both see the latest list.
        const next =
          activeFilter === "unread"
            ? itemsRef.current.filter((n) => n.id !== notification.id)
            : itemsRef.current.map((n) => (n.id === notification.id ? result.notification : n));
        itemsRef.current = next;
        setItems(next);
        // Only RECENT_LIMIT unread items are shown: refill an emptied unread
        // list rather than show "no unread" next to a non-zero count.
        if (activeFilter === "unread" && result.unreadCount > 0 && next.length === 0) {
          void loadList("unread", { silent: true });
        }
      } catch (err) {
        setActionError(errorMessage(err));
        return;
      }
    }
    const href = getNotificationPresentation(notification.type).href;
    if (href) {
      close(false);
      router.push(href);
    }
  }

  async function handleMarkAll() {
    setActionError(null);
    setIsMarkingAll(true);
    try {
      const result = await mockRepository.markAllNotificationsRead();
      setUnreadCount(result.unreadCount);
      // Update the list at once so a failed silent reload cannot leave unread
      // styling next to a zero badge. Read timestamps come from the reload.
      const activeFilter = panelStateRef.current.filter;
      setItems((current) =>
        activeFilter === "unread" ? [] : current.map((n) => (n.isRead ? n : { ...n, isRead: true })),
      );
      await loadList(activeFilter, { silent: true });
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setIsMarkingAll(false);
    }
  }

  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);
  const bellLabel =
    unreadCount > 0
      ? `Thông báo, ${unreadCount} chưa đọc`
      : "Thông báo, không có thông báo mới";

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={bellRef}
        type="button"
        onClick={handleToggle}
        aria-label={bellLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        title="Thông báo"
        className={`relative p-1.5 rounded-lg transition-colors ${
          isOpen
            ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        }`}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-[1.1rem] text-center ring-2 ring-white dark:ring-slate-900"
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="fixed left-2 right-2 top-[4.25rem] z-50 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 max-h-[70vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="min-w-0">
              <h2 id={titleId} className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Thông báo
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400" aria-live="polite">
                {unreadCount > 0 ? `${unreadCount} thông báo chưa đọc` : "Bạn đã xem hết thông báo"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={unreadCount === 0 || isMarkingAll}
              className="shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed"
            >
              {isMarkingAll ? "Đang cập nhật..." : "Đánh dấu tất cả đã đọc"}
            </button>
          </div>

          <div className="flex gap-1 px-4 py-2" role="group" aria-label="Lọc thông báo">
            {(
              [
                { value: "all", label: "Tất cả" },
                { value: "unread", label: `Chưa đọc${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => handleFilterChange(option.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  filter === option.value
                    ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                    : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {actionError && (
            <p role="alert" className="mx-4 mb-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              {actionError}
            </p>
          )}

          <div className="flex-1 overflow-y-auto pb-2">
            {(status === "loading" || status === "idle") && (
              <ul className="px-4 space-y-3 py-2" aria-busy="true" aria-label="Đang tải thông báo">
                {[0, 1, 2].map((key) => (
                  <li key={key} className="flex gap-3 motion-safe:animate-pulse">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
                      <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800" />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {status === "error" && (
              <div role="alert" className="px-4 py-6 text-center">
                <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
                <button
                  type="button"
                  onClick={() => void loadList(filter)}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold"
                >
                  Thử lại
                </button>
              </div>
            )}

            {status === "ready" && items.length === 0 && (
              <div className="px-4 py-8 text-center">
                <div className="text-2xl" aria-hidden="true">🔔</div>
                <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {filter === "unread" ? "Không có thông báo chưa đọc" : "Bạn chưa có thông báo nào"}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Thông báo về điểm thưởng, kích hoạt tài khoản và khảo sát sẽ xuất hiện tại đây.
                </p>
              </div>
            )}

            {status === "ready" && items.length > 0 && (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((notification) => {
                  const presentation = getNotificationPresentation(notification.type);
                  return (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => void handleItemClick(notification)}
                        className={`w-full text-left flex gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                          notification.isRead ? "" : "bg-emerald-50/40 dark:bg-emerald-950/20"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-base ${presentation.iconClass}`}
                        >
                          {presentation.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span
                              className={`text-xs truncate ${
                                notification.isRead
                                  ? "font-semibold text-slate-600 dark:text-slate-300"
                                  : "font-bold text-slate-900 dark:text-slate-100"
                              }`}
                            >
                              {presentation.title}
                            </span>
                            {!notification.isRead && (
                              <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500">
                                <span className="sr-only">Chưa đọc</span>
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400 break-words">
                            {notification.message}
                          </span>
                          <time
                            dateTime={notification.createdAt}
                            className="mt-1 block text-[11px] text-slate-400 dark:text-slate-500"
                          >
                            {formatRelativeTime(notification.createdAt, now)}
                          </time>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
