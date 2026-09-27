"use client";

import { useMemo, useState } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { listPublisherForms, type PublisherFormSummary } from "@/lib/forms/manage-service";
import {
  aggregateStats,
  matchesFilter,
  statusViewOf,
  type ManageFilter,
  type PublisherStatusView,
} from "@/lib/forms/manage-status";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

export interface MyFormRow {
  form: PublisherFormSummary;
  view: PublisherStatusView;
}

/** `/forms` data: every survey of the Publisher, the four stat cards and the status filter. */
export function useMyForms() {
  const query = useApiQuery("publisher-forms", (signal) => listPublisherForms(signal));
  const [filter, setFilter] = useState<ManageFilter>("all");
  // "còn 9 ngày" / "gửi 26/09" are day-level: the time the screen opened is enough.
  const [now] = useState(() => Date.now());
  const sessionLost = useSessionLossRedirect(query.error);

  const forms = query.data?.forms;
  const rows = useMemo<MyFormRow[]>(
    () => (forms ?? []).map((form) => ({ form, view: statusViewOf(form) })),
    [forms],
  );
  const visible = useMemo(() => rows.filter((row) => matchesFilter(row.view, filter)), [rows, filter]);
  const stats = useMemo(() => aggregateStats(forms ?? []), [forms]);

  return {
    loaded: forms !== undefined,
    loading: query.loading || sessionLost,
    error: sessionLost ? null : query.error,
    reload: query.reload,
    rows,
    visible,
    stats,
    filter,
    setFilter,
    now,
  };
}
