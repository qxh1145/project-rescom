"use client";

import { useMemo, useState } from "react";
import { getAdminOverview } from "@/lib/admin/overview-service";
import { flaggedAccountOf, formatAdminToday, statCardsOf, todoRowsOf } from "@/lib/admin/overview-view";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/** `/admin` data: the dashboard aggregate mapped to Figma rows. */
export function useAdminOverview() {
  const query = useApiQuery("admin:overview", (signal) => getAdminOverview(signal));
  // 401 / locked account: SessionGate redirects instead of an error with a useless retry.
  const sessionLost = useSessionLossRedirect(query.error);
  const [now] = useState(() => new Date());
  const overview = query.data;

  const view = useMemo(
    () =>
      overview
        ? {
            cards: statCardsOf(overview),
            todo: todoRowsOf(overview.todo, now),
            flagged: overview.flaggedAccounts.map(flaggedAccountOf),
          }
        : null,
    [overview, now],
  );

  return {
    today: formatAdminToday(now),
    view,
    error: sessionLost ? null : query.error,
    loading: query.loading || sessionLost,
    reload: query.reload,
  };
}
