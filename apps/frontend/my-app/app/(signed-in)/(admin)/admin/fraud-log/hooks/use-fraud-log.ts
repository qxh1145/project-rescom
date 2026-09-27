"use client";

import { useState } from "react";
import { listFraudLog } from "@/lib/admin/fraud-log-service";
import { initialUserText, parseFraudWindow, resolveUserFilter } from "@/lib/admin/fraud-log-view";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/**
 * `/admin/fraud-log[?userId=<uuid|#code>]` data (ASSUMED `GET /admin/fraud-log`).
 * Default window: 14 days (Figma "14 ngày qua").
 */
export function useFraudLog(urlUserId: string | null) {
  const [userText, setUserText] = useState(() => initialUserText(urlUserId));
  const [windowValue, setWindowValue] = useState("14");
  const [type, setType] = useState("");
  const debouncedUser = useDebouncedValue(userText, 300);

  const userFilter = resolveUserFilter(debouncedUser, urlUserId);
  const days = parseFraudWindow(windowValue);
  const key = `admin:fraud-log:${userFilter.userId ?? ""}:${userFilter.search ?? ""}:${days ?? "all"}:${type}`;
  const query = useApiQuery(key, (signal) => listFraudLog({ ...userFilter, days, type: type || undefined }, signal));
  const sessionLost = useSessionLossRedirect(query.error);

  return {
    userText,
    setUserText,
    windowValue,
    setWindowValue,
    type,
    setType,
    data: query.data,
    loading: query.loading || sessionLost,
    error: sessionLost ? null : query.error,
    reload: query.reload,
  };
}
