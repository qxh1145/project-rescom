"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { browserDraftStorage, clearAnswerDraft } from "@/lib/participation/answer-draft";
import { attemptPhase, getAttempt, type AttemptDetails } from "@/lib/participation/attempts-service";
import { cancelFailureOf } from "@/lib/participation/external-code";
import { cancelAttempt, newCancelIdempotencyKey } from "@/lib/participation/external-service";
import { loadAttemptErrorMessage } from "@/lib/participation/participation-messages";
import { consentPath } from "@/lib/participation/start-flow";
import { useSession } from "@/lib/session/SessionProvider";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { FocusError, FocusLoading } from "../../../_participation/FocusPageState";
import { FormUpdatedPanel, SurveyClosedPanel } from "./StatusPanels";
import { SurveyRunnerView } from "./SurveyRunnerView";

/** Where a loaded attempt belongs when it is not an open in-Rescom attempt. */
function redirectFor(attempt: AttemptDetails): string | null {
  if (attempt.type === "EXTERNAL") return `/attempts/${attempt.attemptId}/google-form`;
  if (attempt.status === "COMPLETED") return `/attempts/${attempt.attemptId}/complete`;
  return null;
}

/**
 * `/attempts/:id` — loads the attempt with the questions of its PINNED
 * version (`attempt.form`), then hands over to the runner.
 */
export function SurveyTakingScreen() {
  const params = useParams<{ id: string }>();
  const attemptId = String(params.id);
  const router = useRouter();
  const { refresh } = useSession();
  const attempt = useApiQuery(`attempt:${attemptId}`, (signal) => getAttempt(attemptId, signal));
  const target = attempt.data ? redirectFor(attempt.data) : null;
  const phase = attempt.data ? attemptPhase(attempt.data) : null;
  const closed = phase === "locked" || phase === "cancelled";
  // 401 / locked account while loading: SessionGate redirects; the local draft stays.
  const sessionLost = useSessionLossRedirect(attempt.error);
  const [restart, setRestart] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  // One Idempotency-Key per restart: a retry after a lost answer reuses it.
  // Created on the first click, not during render, so a failure cannot crash the screen.
  const restartKey = useRef<string | null>(null);

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

  const current = attempt.data;
  const form = current.form;
  // An in-Rescom attempt always carries its pinned form (shared schema).
  if (!form) return <FocusError message={loadAttemptErrorMessage(null)} onRetry={attempt.reload} />;

  // Decision E5-D4 (strict): once the survey left PUBLISHED, this attempt can
  // no longer be submitted. A CLOSED survey takes no new attempt either.
  if (phase === "open" && current.survey.status === "CLOSED") return <SurveyClosedPanel />;
  // DRAFT / MODERATION_QUEUE / ESCROW_LOCKED: a new version is being prepared.
  if (phase === "open" && current.survey.status !== "PUBLISHED") {
    // Abandon the stale attempt, drop its draft, start again from the consent screen.
    const restartOnNewVersion = async () => {
      setRestart({ busy: true, error: null });
      try {
        restartKey.current ??= newCancelIdempotencyKey();
        await cancelAttempt(current.attemptId, restartKey.current);
      } catch (cause) {
        const failed = cancelFailureOf(cause);
        if (failed.kind === "session") {
          setRestart({ busy: false, error: null });
          refresh();
          return;
        }
        if (failed.kind === "completed") {
          router.replace(`/attempts/${encodeURIComponent(current.attemptId)}/complete`);
          return;
        }
        // Already closed: nothing left to cancel. Anything else blocks the restart.
        if (failed.kind === "message") {
          setRestart({ busy: false, error: "Chưa bắt đầu lại được. Vui lòng thử lại." });
          return;
        }
      }
      clearAnswerDraft(browserDraftStorage(), current.attemptId);
      router.replace(consentPath(current.formId));
    };
    return (
      <FormUpdatedPanel
        onRestart={() => void restartOnNewVersion()}
        onRetryLater={attempt.reload}
        busy={restart.busy}
        error={restart.error}
      />
    );
  }

  return <SurveyRunnerView key={current.attemptId} attempt={current} form={form} />;
}
