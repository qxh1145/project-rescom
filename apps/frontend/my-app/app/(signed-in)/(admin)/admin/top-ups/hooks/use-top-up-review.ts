"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { TopUpStatus } from "@rescom/schemas";
import { useAdminCounts } from "@/components/layout/admin/AdminShell";
import { nextSelectedId, requesterName } from "@/lib/admin/top-up-admin";
import { isStaleReviewError, topUpReviewErrorMessage } from "@/lib/admin/top-up-admin-messages";
import {
  approveTopUp,
  listAdminTopUps,
  rejectTopUp,
  type AdminTopUp,
} from "@/lib/admin/top-up-admin-service";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { formatPoints } from "@/lib/wallet/top-up";

export type ReviewAction = "approve" | "reject";

/** `/admin/top-ups` state: status tab, selected request, checklist, approve / reject. */
export function useTopUpReview() {
  const [status, setStatusState] = useState<TopUpStatus>("PENDING");
  const query = useApiQuery(`admin:top-ups:${status}`, (signal) => listAdminTopUps({ status }, signal));
  const { counts, refreshCounts } = useAdminCounts();
  // `?id=<topUpId>` (links from the overview) preselects that request when it is in the list.
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("id"));
  const [checks, setChecks] = useState<{ id: string | null; values: boolean[] }>({ id: null, values: [] });
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [failure, setFailure] = useState<{ action: ReviewAction; error: unknown } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionLost = useSessionLossRedirect(query.error, failure?.error);
  const { reload } = query;

  const items: AdminTopUp[] = query.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const checked = selected && checks.id === selected.id ? checks.values : [];

  const setStatus = useCallback((next: TopUpStatus) => {
    setStatusState(next);
    setSelectedId(null);
    setFailure(null);
    setNotice(null);
  }, []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setFailure(null);
  }, []);

  const toggleCheck = useCallback(
    (index: number, value: boolean) => {
      if (!selected) return;
      setChecks((current) => {
        const values = current.id === selected.id ? [...current.values] : [];
        values[index] = value;
        return { id: selected.id, values };
      });
    },
    [selected],
  );

  /** Runs a decision; on success moves to the next request and refreshes the list + sidebar badge. */
  async function review(action: ReviewAction, target: AdminTopUp, reason?: string): Promise<boolean> {
    if (busy) return false;
    setBusy(action);
    setFailure(null);
    setNotice(null);
    const ids = items.map((item) => item.id);
    try {
      const result = action === "approve" ? await approveTopUp(target.id) : await rejectTopUp(target.id, reason ?? "");
      const name = requesterName(result.topUp);
      setNotice(
        action === "approve"
          ? `Đã cộng ${formatPoints(result.topUp.amount)} điểm cho ${name}.`
          : `Đã từ chối yêu cầu ${formatPoints(result.topUp.amount)} điểm của ${name}.`,
      );
      const remaining = items.filter((item) => item.id !== target.id);
      setSelectedId(nextSelectedId(remaining, target.id, ids));
      reload();
      refreshCounts();
      return true;
    } catch (error) {
      setFailure({ action, error });
      if (isStaleReviewError(error)) {
        reload();
        refreshCounts();
      }
      return false;
    } finally {
      setBusy(null);
    }
  }

  return {
    status,
    setStatus,
    /** Size of the pending queue for "Chờ duyệt · N" (fresh list on that tab, else the sidebar count). */
    pendingCount: status === "PENDING" ? query.data?.total : counts?.topUps,
    items,
    total: query.data?.total ?? 0,
    loading: (query.loading && !query.data) || sessionLost,
    refreshing: query.loading && Boolean(query.data),
    error: sessionLost ? null : query.error,
    reload,
    selected,
    select,
    checked,
    toggleCheck,
    busy,
    /** Failed decision (copy + which action), for the panel or the reject dialog. */
    failure: sessionLost || !failure ? null : { action: failure.action, message: topUpReviewErrorMessage(failure.error, failure.action) },
    clearFailure: () => setFailure(null),
    notice,
    review,
  };
}
