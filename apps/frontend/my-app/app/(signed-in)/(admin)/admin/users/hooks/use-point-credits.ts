"use client";

import { useCallback, useRef, useState } from "react";
import type { AdminPointCreditListItem } from "@rescom/schemas";
import { useApiQuery } from "@/lib/api/use-api-query";
import { userActionErrorMessage } from "@/lib/admin/users-messages";
import {
  creditAdminUserPoints,
  listAdminUserPointCredits,
  reverseAdminPointCredit,
} from "@/lib/admin/users-service";
import { isSessionLost } from "@/lib/session/session-status";
import { useSession } from "@/lib/session/SessionProvider";

export function usePointCredits(userId: string, onDetailReload?: () => void) {
  const { refresh } = useSession();
  const [busy, setBusy] = useState<"credit" | "reverse" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  const fetchCredits = useCallback(
    (signal?: AbortSignal) => listAdminUserPointCredits(userId, signal),
    [userId],
  );

  const query = useApiQuery(`admin:user:${userId}:credits`, fetchCredits);

  const credit = useCallback(
    async (
      amount: number,
      reason: string,
      idempotencyKey: string,
    ): Promise<boolean> => {
      if (sending.current) return false;
      sending.current = true;
      setBusy("credit");
      setError(null);
      try {
        await creditAdminUserPoints(userId, {
          amount,
          reason,
          idempotencyKey,
        });
        query.reload();
        onDetailReload?.();
        return true;
      } catch (cause) {
        if (isSessionLost(cause)) {
          refresh();
        } else {
          setError(userActionErrorMessage(cause, "credit"));
        }
        return false;
      } finally {
        setBusy(null);
        sending.current = false;
      }
    },
    [userId, query, onDetailReload, refresh],
  );

  const reverse = useCallback(
    async (journalId: string, reason: string): Promise<boolean> => {
      if (sending.current) return false;
      sending.current = true;
      setBusy("reverse");
      setError(null);
      try {
        await reverseAdminPointCredit(journalId, reason);
        query.reload();
        onDetailReload?.();
        return true;
      } catch (cause) {
        if (isSessionLost(cause)) {
          refresh();
        } else {
          setError(userActionErrorMessage(cause, "reverse"));
        }
        return false;
      } finally {
        setBusy(null);
        sending.current = false;
      }
    },
    [query, onDetailReload, refresh],
  );

  return {
    items: (query.data?.items ?? []) as AdminPointCreditListItem[],
    loading: query.loading,
    queryError: query.error,
    busy,
    error,
    clearError: () => setError(null),
    reload: query.reload,
    credit,
    reverse,
  };
}
