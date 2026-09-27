"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { topUpTransferPath } from "@/lib/wallet/top-up";
import { createTopUpRequest, latestPendingTopUp } from "@/lib/wallet/top-up-service";
import { createTopUpErrorMessage, isPendingLimitError } from "@/lib/wallet/wallet-messages";

/**
 * 14a "Tiếp tục: thông tin chuyển khoản" and the desktop wallet card
 * "Xem thông tin chuyển khoản": create the request (the backend returns the
 * bank details and transfer reference), then open 14b.
 */
export function useCreateTopUp() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** After `TOPUP_PENDING_LIMIT_REACHED`: the newest open request, to finish its transfer. */
  const [resumeHref, setResumeHref] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  // 401 / locked account: SessionGate redirects instead of showing an error.
  const sessionLost = useSessionLossRedirect(failure);

  const create = useCallback(
    async (points: number) => {
      setSubmitting(true);
      setError(null);
      setResumeHref(null);
      setFailure(null);
      try {
        const request = await createTopUpRequest(points);
        router.push(topUpTransferPath(request.id));
      } catch (cause) {
        setFailure(cause);
        setError(createTopUpErrorMessage(cause));
        setSubmitting(false);
        if (isPendingLimitError(cause)) {
          const open = await latestPendingTopUp().catch(() => null);
          if (open) setResumeHref(topUpTransferPath(open.id));
        }
      }
    },
    [router],
  );

  return { create, submitting: submitting || sessionLost, error: sessionLost ? null : error, resumeHref };
}
