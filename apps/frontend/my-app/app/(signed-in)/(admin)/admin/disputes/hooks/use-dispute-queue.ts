"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useAdminCounts } from "@/components/layout/admin/AdminShell";
import { listOpenDisputeCases, type DisputeCase, type DisputeCaseKind } from "@/lib/admin/disputes-service";
import { DISPUTE_TABS, casesOfKind, defaultTab } from "@/lib/admin/disputes-view";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/**
 * Open cases (ASSUMED `GET /admin/disputes?status=OPEN`), the active header
 * tab and the case shown in the detail card. A decision drops the case
 * locally and refreshes the sidebar badge. `?id=<caseId>` (links from the
 * overview) opens that case on its own tab.
 */
export function useDisputeQueue() {
  const query = useApiQuery("admin:disputes", (signal) => listOpenDisputeCases(signal));
  const sessionLost = useSessionLossRedirect(query.error);
  const { refreshCounts } = useAdminCounts();
  const [chosenTab, setChosenTab] = useState<DisputeCaseKind | null>(null);
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("id"));
  const [now] = useState(() => Date.now());

  // Until a tab is picked, the selected (linked) case decides which tab shows.
  const linkedKind =
    chosenTab === null && selectedId ? query.data?.items.find((item) => item.id === selectedId)?.kind : undefined;
  // A linked case of a kind the pilot build hides must not open its tab.
  const shownKind = linkedKind && DISPUTE_TABS.some((t) => t.kind === linkedKind) ? linkedKind : undefined;
  const tab = chosenTab ?? shownKind ?? defaultTab(query.data?.counts);
  const cases = useMemo(() => casesOfKind(query.data?.items ?? [], tab), [query.data, tab]);
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0] ?? null;

  const { setData, reload } = query;
  const removeCase = useCallback(
    (resolved: DisputeCase) => {
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== resolved.id),
              counts: { ...current.counts, [resolved.kind]: Math.max(0, current.counts[resolved.kind] - 1) },
            }
          : current,
      );
      refreshCounts();
    },
    [setData, refreshCounts],
  );

  /** Another admin decided first: reload the queue and the badge. */
  const reloadAll = useCallback(() => {
    reload();
    refreshCounts();
  }, [reload, refreshCounts]);

  return {
    counts: query.data?.counts,
    /** Real missing-code reports (read only); undefined in full-mock mode. */
    reports: query.data?.missingCodeReports,
    cases,
    selected,
    tab,
    selectTab: (kind: DisputeCaseKind) => {
      setChosenTab(kind);
      setSelectedId(null);
    },
    selectCase: setSelectedId,
    loading: (query.loading && !query.data) || sessionLost,
    error: sessionLost ? null : query.error,
    reload: query.reload,
    removeCase,
    reloadAll,
    now,
  };
}
