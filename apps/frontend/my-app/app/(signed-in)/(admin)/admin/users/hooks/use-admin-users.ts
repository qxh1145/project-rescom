"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { UserStatus } from "@rescom/schemas";
import { getAdminUser, listAdminUsers, type AdminUserView } from "@/lib/admin/users-service";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

export type StatusFilter = "" | UserStatus;

/**
 * `/admin/users` data: the filtered list (VERIFIED `GET /admin/users`) and the
 * selected user's profile (`GET /admin/users/:id`). The selection lives in
 * `?id=` so FraudLog "Xem hồ sơ & quyết định" can deep-link to it.
 */
export function useAdminUsers() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearchText] = useState("");
  const [status, setStatusFilter] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const list = useApiQuery(`admin:users:${page}:${status}:${debouncedSearch}`, (signal) =>
    listAdminUsers({ page, search: debouncedSearch || undefined, status: status || undefined }, signal),
  );

  const urlId = searchParams.get("id");
  const selectedId = urlId ?? list.data?.items[0]?.id ?? null;
  const detail = useApiQuery(selectedId ? `admin:user:${selectedId}` : null, (signal) =>
    getAdminUser(selectedId as string, signal),
  );
  const sessionLost = useSessionLossRedirect(list.error, detail.error);

  const listRow = list.data?.items.find((user) => user.id === selectedId);
  // The list row shows at once; the detail call refreshes it (and serves deep links to other pages).
  const selected = detail.data ?? listRow ?? null;

  const select = useCallback(
    (id: string) => router.replace(`${pathname}?id=${encodeURIComponent(id)}`, { scroll: false }),
    [pathname, router],
  );

  const { setData: setList } = list;
  const { setData: setDetail, reload: reloadDetail } = detail;
  /**
   * Merge a PATCH result (the VERIFIED payload has no ASSUMED fields, so keep the ones we have).
   * The detail holds whoever is selected now: it only takes the result when it is the same
   * user (the admin may have switched rows mid-request), then refetches the full profile.
   */
  const applyUpdate = useCallback(
    (user: AdminUserView) => {
      setDetail((current) => (current?.id === user.id ? { ...current, ...user } : current));
      setList((current) =>
        current
          ? { ...current, items: current.items.map((item) => (item.id === user.id ? { ...item, ...user } : item)) }
          : current,
      );
      if (user.id === selectedId) reloadDetail();
    },
    [setDetail, setList, reloadDetail, selectedId],
  );

  return {
    search,
    setSearch: (value: string) => {
      setSearchText(value);
      setPage(1);
    },
    status,
    setStatus: (value: StatusFilter) => {
      setStatusFilter(value);
      setPage(1);
    },
    page,
    setPage,
    list: {
      data: list.data,
      loading: list.loading || sessionLost,
      error: sessionLost ? null : list.error,
      reload: list.reload,
    },
    selectedId,
    selected,
    detail: {
      loading: detail.loading && !selected,
      error: sessionLost || detail.data ? null : detail.error,
      reload: detail.reload,
    },
    select,
    applyUpdate,
  };
}
