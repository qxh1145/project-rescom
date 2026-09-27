"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useAdminCounts } from "@/components/layout/admin/AdminShell";
import { useApiQuery } from "@/lib/api/use-api-query";
import {
  MODERATION_APPROVE_FAILED,
  approvedNotice,
  isStaleDecisionError,
  moderationErrorMessage,
  rejectedNotice,
} from "@/lib/admin/moderation-messages";
import {
  approveModerationSurvey,
  getModerationSurvey,
  listModerationQueue,
  rejectModerationSurvey,
  type ModerationPreview,
} from "@/lib/admin/moderation-service";
import { nextSelection } from "@/lib/admin/moderation-view";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/**
 * `/admin/surveys[?id=<formId>]`: queue (oldest first) + the selected
 * survey's preview. Without `id` the oldest queued survey is shown.
 */
export function useSurveyModeration() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { refreshCounts } = useAdminCounts();

  const queue = useApiQuery("admin:moderation-queue", (signal) => listModerationQueue({}, signal));
  const requestedId = searchParams.get("id");
  const selectedId = requestedId ?? queue.data?.items[0]?.formId ?? null;
  const detail = useApiQuery(selectedId ? `admin:moderation:${selectedId}` : null, (signal) =>
    getModerationSurvey(selectedId as string, signal),
  );
  const sessionLost = useSessionLossRedirect(queue.error, detail.error);

  const [approving, setApproving] = useState(false);
  // Scoped to the survey it belongs to, so it disappears when another one is selected.
  const [actionError, setActionError] = useState<{ formId: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const select = useCallback(
    (formId: string | null) => {
      router.replace(formId ? `${pathname}?id=${encodeURIComponent(formId)}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  /** Drops the decided survey at once, moves on, then refetches queue + badge. */
  const afterDecision = useCallback(
    (formId: string, message: string) => {
      const ids = queue.data?.items.map((item) => item.formId) ?? [];
      queue.setData((current) =>
        current
          ? {
              ...current,
              items: current.items.filter((item) => item.formId !== formId),
              total: Math.max(0, current.total - 1),
            }
          : current,
      );
      setNotice(message);
      select(nextSelection(ids, formId));
      queue.reload();
      refreshCounts();
    },
    [queue, refreshCounts, select],
  );

  const approve = useCallback(
    async (survey: ModerationPreview) => {
      setApproving(true);
      setActionError(null);
      setNotice(null);
      try {
        await approveModerationSurvey(survey.formId, survey.formVersionId);
        afterDecision(survey.formId, approvedNotice(survey.title));
      } catch (cause) {
        setActionError({ formId: survey.formId, message: moderationErrorMessage(cause, MODERATION_APPROVE_FAILED) });
        if (isStaleDecisionError(cause)) {
          queue.reload();
          detail.reload();
          refreshCounts();
        }
      } finally {
        setApproving(false);
      }
    },
    [afterDecision, detail, queue, refreshCounts],
  );

  /** Called by the reject dialog; errors are thrown back to it. */
  const reject = useCallback(
    async (survey: ModerationPreview, reason: string) => {
      setNotice(null);
      try {
        const result = await rejectModerationSurvey(survey.formId, { formVersionId: survey.formVersionId, reason });
        afterDecision(survey.formId, rejectedNotice(survey.title, result.decision.refundAmount));
      } catch (cause) {
        if (isStaleDecisionError(cause)) {
          queue.reload();
          detail.reload();
          refreshCounts();
        }
        throw cause;
      }
    },
    [afterDecision, detail, queue, refreshCounts],
  );

  return {
    queue: {
      items: queue.data?.items,
      total: queue.data?.total ?? 0,
      hasMore: queue.data?.hasMore ?? false,
      loading: queue.loading || sessionLost,
      error: sessionLost ? null : queue.error,
      reload: queue.reload,
    },
    detail: {
      survey: detail.data,
      loading: detail.loading || sessionLost,
      error: sessionLost ? null : detail.error,
      reload: detail.reload,
    },
    selectedId,
    select,
    approve,
    approving,
    reject,
    actionError: actionError && actionError.formId === selectedId ? actionError.message : null,
    clearActionError: () => setActionError(null),
    notice,
    clearNotice: () => setNotice(null),
  };
}
