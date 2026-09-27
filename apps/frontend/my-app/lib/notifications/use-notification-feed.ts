"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApiQuery } from "../api/use-api-query.ts";
import { useSession } from "../session/SessionProvider.tsx";
import { useSessionLossRedirect } from "../session/use-session-loss.ts";
import { NOTIFICATION_MESSAGES } from "./notification-messages.ts";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
  type NotificationPage,
} from "./notification-service.ts";

export type NotificationFilter = "all" | "unread";

interface FeedOptions {
  /** Page size of the first request and of each "Tải thêm" (max 50, the backend limit). */
  pageSize: number;
  /** `false` skips the request (closed panel). */
  enabled?: boolean;
  /** Changes force a fresh list (each time the panel opens). */
  instance?: number;
}

/** One `GET /notifications` response and when it was requested (client clock). */
interface FetchedPage {
  page: NotificationPage;
  requestedAt: number;
}

/** "Tải thêm" pages, tied to the first page they continue. */
interface OlderPages {
  base: FetchedPage;
  pages: FetchedPage[];
}

/**
 * Reads made here. They are applied over every fetched page, so a list
 * request that was in flight while a row was marked cannot bring the unread
 * state back; responses requested before the last mark do not drive the badge.
 */
interface LocalReads {
  /** id → readAt */
  readIds: ReadonlyMap<string, string>;
  /** "Đánh dấu đã đọc" succeeded at this time: older responses are all read. */
  allReadAt: number | null;
}

/** Merges pages (deduplicated: offsets shift when rows arrive) and applies the local reads. */
export function mergeNotificationPages(pages: readonly FetchedPage[], local: LocalReads): NotificationItem[] {
  const seen = new Set<string>();
  const items: NotificationItem[] = [];
  for (const { page, requestedAt } of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (item.isRead) {
        items.push(item);
        continue;
      }
      const readAt =
        local.readIds.get(item.id) ??
        (local.allReadAt !== null && requestedAt < local.allReadAt ? new Date(local.allReadAt).toISOString() : null);
      items.push(readAt ? { ...item, isRead: true, readAt } : item);
    }
  }
  return items;
}

const NO_LOCAL_READS: LocalReads = { readIds: new Map(), allReadAt: null };

/**
 * Notification list state for the header panel and `/notifications` (Figma 14d).
 * VERIFIED endpoints (`notification-service.ts`), paged with `offset`. Every
 * current response that carries `unreadCount` updates the session badge.
 */
export function useNotificationFeed({ pageSize, enabled = true, instance = 0 }: FeedOptions) {
  const { unreadCount, setUnreadCount } = useSession();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [older, setOlder] = useState<OlderPages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionFailure, setActionFailure] = useState<unknown>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [local, setLocal] = useState<LocalReads>(NO_LOCAL_READS);
  /** Last successful mark (single or all): responses requested earlier do not set the badge. */
  const markedAtRef = useRef(0);

  const query = useApiQuery(enabled ? `notifications:${filter}:${instance}` : null, async (signal): Promise<FetchedPage> => {
    const requestedAt = Date.now();
    const page = await listNotifications({ limit: pageSize, unreadOnly: filter === "unread" }, signal);
    return { page, requestedAt };
  });
  const { data: first, reload } = query;
  // 401 / locked account: SessionGate redirects instead of an error with a useless retry.
  const sessionLost = useSessionLossRedirect(query.error, loadMoreError, actionFailure);

  useEffect(() => {
    if (first && first.requestedAt >= markedAtRef.current) setUnreadCount(first.page.unreadCount);
  }, [first, setUnreadCount]);

  const extra = older && older.base === first ? older : null;
  const list = useMemo(() => {
    if (!first) return undefined;
    const pages = [first, ...(extra?.pages ?? [])];
    return { items: mergeNotificationPages(pages, local), hasMore: pages[pages.length - 1].page.hasMore };
  }, [first, extra, local]);

  const changeFilter = useCallback((next: NotificationFilter) => {
    setFilter(next);
    setOlder(null);
    setLoadMoreError(null);
    setActionError(null);
  }, []);

  const loadMore = useCallback(async () => {
    if (!first || loadingMore) return;
    const last = (extra?.pages[extra.pages.length - 1] ?? first).page;
    if (!last.hasMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    const requestedAt = Date.now();
    try {
      const page = await listNotifications({
        limit: pageSize,
        offset: last.offset + last.limit,
        unreadOnly: filter === "unread",
      });
      setOlder({ base: first, pages: [...(extra?.pages ?? []), { page, requestedAt }] });
      if (requestedAt >= markedAtRef.current) setUnreadCount(page.unreadCount);
    } catch (error) {
      setLoadMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  }, [first, extra, loadingMore, pageSize, filter, setUnreadCount]);

  const recordMark = useCallback((update: (current: LocalReads, at: number) => LocalReads) => {
    const at = Date.now();
    markedAtRef.current = at;
    setLocal((current) => update(current, at));
  }, []);

  const markRead = useCallback(
    async (item: NotificationItem) => {
      if (item.isRead) return;
      setActionError(null);
      setActionFailure(null);
      try {
        const result = await markNotificationRead(item.id);
        const readAt = result.notification.readAt ?? new Date().toISOString();
        recordMark((current) => ({ ...current, readIds: new Map(current.readIds).set(item.id, readAt) }));
        setUnreadCount(result.unreadCount);
      } catch (error) {
        setActionFailure(error);
        setActionError(NOTIFICATION_MESSAGES.markReadFailed);
      }
    },
    [recordMark, setUnreadCount],
  );

  const markAllRead = useCallback(async () => {
    setActionError(null);
    setActionFailure(null);
    setMarkingAll(true);
    try {
      const result = await markAllNotificationsRead();
      recordMark((current, at) => ({ ...current, allReadAt: at }));
      setUnreadCount(result.unreadCount);
    } catch (error) {
      setActionFailure(error);
      setActionError(NOTIFICATION_MESSAGES.markReadFailed);
    } finally {
      setMarkingAll(false);
    }
  }, [recordMark, setUnreadCount]);

  return {
    filter,
    changeFilter,
    list,
    loading: query.loading || sessionLost,
    error: sessionLost ? null : query.error,
    reload,
    loadMore,
    canLoadMore: Boolean(list?.hasMore),
    loadingMore,
    loadMoreFailed: Boolean(loadMoreError) && !sessionLost,
    unreadCount,
    markRead,
    markAllRead,
    markingAll,
    actionError: sessionLost ? null : actionError,
  };
}

export type NotificationFeed = ReturnType<typeof useNotificationFeed>;
