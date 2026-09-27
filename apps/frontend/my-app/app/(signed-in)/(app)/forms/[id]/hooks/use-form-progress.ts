"use client";

import { useState } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useFormHeader } from "@/lib/forms/manage-header-context";
import { getFormProgress, type OpensRange } from "@/lib/forms/manage-service";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/**
 * Tiến độ data (ASSUMED `GET /forms/:id/progress`). The page loads with the
 * "Ngày" range; another range only refetches the chart, so the cards around
 * it never blank out. Close / reopen / pause (`revision`) reload both in place.
 */
export function useFormProgress() {
  const { formId, revision } = useFormHeader();
  const [range, setRange] = useState<OpensRange>("day");
  const [now] = useState(() => Date.now());

  const main = useApiQuery(`form-progress:${formId}`, (signal) => getFormProgress(formId, "day", signal));
  const other = useApiQuery(range === "day" ? null : `form-opens:${formId}:${range}`, (signal) =>
    getFormProgress(formId, range, signal),
  );
  // A close / reopen / pause / dispute bumps `revision`: reload in place (the cards keep their data).
  const [seenRevision, setSeenRevision] = useState(revision);
  if (seenRevision !== revision) {
    setSeenRevision(revision);
    main.reload();
    if (range !== "day") other.reload();
  }
  const sessionLost = useSessionLossRedirect(main.error, other.error);

  const opens = range === "day" ? main.data?.opens : other.data?.opens;
  return {
    progress: main.data,
    error: sessionLost ? null : main.error,
    loading: main.loading || sessionLost,
    reload: main.reload,
    range,
    setRange,
    opens,
    opensLoading: range !== "day" && other.loading,
    opensError: range !== "day" && !sessionLost ? other.error : null,
    reloadOpens: other.reload,
    now,
  };
}
