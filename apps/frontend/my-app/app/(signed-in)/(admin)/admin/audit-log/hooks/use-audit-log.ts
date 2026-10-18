"use client";

import { useMemo, useState } from "react";
import { AUDIT_LOG_PAGE_SIZE } from "@rescom/schemas";
import {
  listAuditLogs,
  type AuditLogItem,
} from "@/lib/admin/audit-log-service";
import {
  auditLogSearch,
  parseAuditFilters,
  type AuditFilterErrors,
} from "@/lib/admin/audit-log-view";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

export function useAuditLog() {
  const [action, setActionState] = useState("");
  const [userId, setUserIdState] = useState("");
  const [targetUserId, setTargetUserIdState] = useState("");
  const [outcome, setOutcomeState] = useState("");
  const [startDate, setStartDateState] = useState("");
  const [endDate, setEndDateState] = useState("");
  const [page, setPage] = useState(1);

  const debouncedUserId = useDebouncedValue(userId, 300);
  const debouncedTargetUserId = useDebouncedValue(targetUserId, 300);

  const parsed = useMemo(
    () =>
      parseAuditFilters({
        action,
        userId: debouncedUserId,
        targetUserId: debouncedTargetUserId,
        outcome,
        startDate,
        endDate,
        page,
        limit: AUDIT_LOG_PAGE_SIZE,
      }),
    [
      action,
      debouncedUserId,
      debouncedTargetUserId,
      outcome,
      startDate,
      endDate,
      page,
    ],
  );

  const filterErrors: AuditFilterErrors = parsed.errors ?? {};
  const validQuery = parsed.query ?? null;

  const key = validQuery ? `admin:audit-log:${auditLogSearch(validQuery)}` : null;

  const apiQuery = useApiQuery(key, (signal) => listAuditLogs(validQuery!, signal));
  const sessionLost = useSessionLossRedirect(apiQuery.error);

  const setAction = (val: string) => {
    setActionState(val);
    setPage(1);
  };

  const setUserId = (val: string) => {
    setUserIdState(val);
    setPage(1);
  };

  const setTargetUserId = (val: string) => {
    setTargetUserIdState(val);
    setPage(1);
  };

  const setOutcome = (val: string) => {
    setOutcomeState(val);
    setPage(1);
  };

  const setStartDate = (val: string) => {
    setStartDateState(val);
    setPage(1);
  };

  const setEndDate = (val: string) => {
    setEndDateState(val);
    setPage(1);
  };

  return {
    action,
    setAction,
    userId,
    setUserId,
    targetUserId,
    setTargetUserId,
    outcome,
    setOutcome,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    page,
    setPage,
    filterErrors,
    data: apiQuery.data,
    items: (apiQuery.data?.items ?? []) as AuditLogItem[],
    pagination: apiQuery.data?.pagination,
    loading: apiQuery.loading || sessionLost,
    error: sessionLost ? null : apiQuery.error,
    reload: apiQuery.reload,
  };
}
