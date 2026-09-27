"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isApiError } from "@/lib/api/api-error";
import { useApiQuery } from "@/lib/api/use-api-query";
import { browserDraftStorage, clearAnswerDraft } from "@/lib/participation/answer-draft";
import { attemptPhase, getAttempt, type AttemptDetails } from "@/lib/participation/attempts-service";
import { cancelAttempt } from "@/lib/participation/external-service";
import { loadAttemptErrorMessage } from "@/lib/participation/participation-messages";
import { consentPath } from "@/lib/participation/start-flow";
import { getSurveyForm } from "@/lib/participation/survey-form-service";
import { isSessionLost } from "@/lib/session/session-status";
import { useSession } from "@/lib/session/SessionProvider";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { FocusError, FocusLoading } from "../../../_participation/FocusPageState";
import { FormUpdatedPanel } from "./StatusPanels";
import { SurveyRunnerView } from "./SurveyRunnerView";

/** Where a loaded attempt belongs when it is not an open in-Rescom attempt. */
function redirectFor(attempt: AttemptDetails): string | null {
  if (attempt.type === "EXTERNAL") return `/attempts/${attempt.attemptId}/google-form`;
  if (attempt.status === "COMPLETED") return `/attempts/${attempt.attemptId}/complete`;
  return null;
}

/**
 * The attempt is pinned to a FormVersion; `GET /public/forms/:id` serves the
 * current one. Different numbers → the attempt's answers no longer fit.
 * Unknown on either side (ASSUMED field missing) → no check.
 */
function isVersionMismatch(attempt: AttemptDetails, formVersionNumber: number): boolean {
  return typeof attempt.versionNumber === "number" && attempt.versionNumber !== formVersionNumber;
}

/** `/attempts/:id` — loads the attempt and its questions, then hands over to the runner. */
export function SurveyTakingScreen() {
  const params = useParams<{ id: string }>();
  const attemptId = String(params.id);
  const router = useRouter();
  const { refresh } = useSession();
  const attempt = useApiQuery(`attempt:${attemptId}`, (signal) => getAttempt(attemptId, signal));
  const target = attempt.data ? redirectFor(attempt.data) : null;
  const phase = attempt.data ? attemptPhase(attempt.data) : null;
  const closed = phase === "locked" || phase === "cancelled";
  const formId = attempt.data && !target && !closed ? attempt.data.formId : null;
  const form = useApiQuery(formId ? `survey-form:${formId}` : null, (signal) => getSurveyForm(formId ?? "", signal));
  // 401 / locked account while loading: SessionGate redirects; the local draft stays.
  const sessionLost = useSessionLossRedirect(attempt.error, form.error);
  const [restart, setRestart] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

  if (sessionLost) return <FocusLoading label="Đang kiểm tra phiên đăng nhập…" />;
  if (attempt.error) {
    return <FocusError message={loadAttemptErrorMessage(attempt.error)} onRetry={attempt.reload} />;
  }
  if (!attempt.data || target) return <FocusLoading label="Đang mở khảo sát…" />;
  if (closed) {
    return (
      <FocusError
        title="Lượt làm đã đóng"
        message="Lượt làm này đã bị huỷ hoặc khoá nên không thể tiếp tục."
      />
    );
  }
  if (form.error) return <FocusError message={loadAttemptErrorMessage(form.error)} onRetry={form.reload} />;
  if (!form.data) return <FocusLoading label="Đang tải câu hỏi…" />;

  const current = attempt.data;
  if (phase === "open" && isVersionMismatch(current, form.data.versionNumber)) {
    // Abandon the stale attempt (ASSUMED cancel route), drop its draft, start again on the new version.
    const restartOnNewVersion = async () => {
      setRestart({ busy: true, error: null });
      try {
        await cancelAttempt(current.attemptId);
      } catch (cause) {
        if (isSessionLost(cause)) {
          setRestart({ busy: false, error: null });
          refresh();
          return;
        }
        // 409 = no longer in progress: nothing left to cancel. Anything else blocks the restart.
        if (!(isApiError(cause) && cause.status === 409)) {
          setRestart({ busy: false, error: "Chưa bắt đầu lại được. Vui lòng thử lại." });
          return;
        }
      }
      clearAnswerDraft(browserDraftStorage(), current.attemptId);
      router.replace(consentPath(current.formId));
    };
    return <FormUpdatedPanel onRestart={() => void restartOnNewVersion()} busy={restart.busy} error={restart.error} />;
  }

  return <SurveyRunnerView key={current.attemptId} attempt={current} form={form.data} />;
}
