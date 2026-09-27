"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useAdminCounts } from "@/components/layout/admin/AdminShell";
import { isStaleReviewError, qualityDecisionErrorMessage } from "@/lib/admin/quality-messages";
import {
  decideQualityReview,
  listQualityReviews,
  type QualityDecisionCommand,
  type QualityReview,
} from "@/lib/admin/quality-service";
import { decisionSavedText, nextReviewId } from "@/lib/admin/quality-view";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

export interface QualityNotice {
  tone: "info" | "danger";
  text: string;
}

/**
 * `/admin/quality` data: the open reviews, the one selected by `?id=` (else
 * the first) and the decision action. After a decision the item leaves the
 * queue, the next one opens and the sidebar badge is refreshed.
 */
export function useQualityReviews() {
  const query = useApiQuery("admin:quality-reviews", (signal) => listQualityReviews(signal));
  const { setData, reload } = query;
  const { refreshCounts } = useAdminCounts();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [decisionError, setDecisionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<QualityNotice | null>(null);
  const sessionLost = useSessionLossRedirect(query.error, decisionError);

  const items = query.data?.items;
  const requestedId = searchParams.get("id");
  const selected: QualityReview | null =
    items?.find((item) => item.responseId === requestedId) ?? items?.[0] ?? null;

  const hrefFor = useCallback(
    (responseId: string) => `${pathname}?id=${encodeURIComponent(responseId)}`,
    [pathname],
  );

  /** Saves a decision; resolves with the error to show next to the form, or null on success. */
  const decide = useCallback(
    async (review: QualityReview, command: QualityDecisionCommand): Promise<unknown> => {
      setDecisionError(null);
      setNotice(null);
      try {
        const result = await decideQualityReview(review.responseId, command);
        setNotice({ tone: "info", text: decisionSavedText(review.reference, result.decision, result.points) });
        const next = nextReviewId(items ?? [], review.responseId);
        router.replace(next ? hrefFor(next) : pathname, { scroll: false });
        setData((current) =>
          current
            ? {
                items: current.items.filter((item) => item.responseId !== review.responseId),
                total: Math.max(0, current.total - 1),
              }
            : current,
        );
        reload();
        refreshCounts();
        return null;
      } catch (error) {
        setDecisionError(error);
        if (isStaleReviewError(error)) {
          // The item left the queue: say so above the list, which reloads without it.
          setNotice({ tone: "danger", text: qualityDecisionErrorMessage(error) });
          reload();
          refreshCounts();
        }
        return error;
      }
    },
    [items, hrefFor, pathname, setData, reload, refreshCounts, router],
  );

  return {
    items: items ?? null,
    selected,
    hrefFor,
    error: sessionLost ? null : query.error,
    loading: query.loading || sessionLost,
    reload,
    decide,
    notice,
    clearNotice: () => setNotice(null),
  };
}
