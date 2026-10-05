"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getAttempt } from "@/lib/participation/attempts-service";
import { resolveCompletionView } from "@/lib/participation/completion-view";
import { getSurveyFeedbackStatus } from "@/lib/participation/feedback-service";
import { attemptPath } from "@/lib/participation/start-flow";
import { getAttemptOutcome, readStashedSubmission } from "@/lib/participation/submission-service";
import { useSession } from "@/lib/session/SessionProvider";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/**
 * `/attempts/:id/complete` data: the attempt, its reward outcome (falls back
 * to the stashed submit response, then the attempt) and the feedback
 * eligibility. Works for in-Rescom and Google Forms attempts.
 */
export function useCompletion(attemptId: string) {
  const router = useRouter();
  const { refresh } = useSession();
  const attempt = useApiQuery(`attempt:${attemptId}`, (signal) => getAttempt(attemptId, signal));
  const finished = attempt.data?.status === "COMPLETED";
  const outcome = useApiQuery(finished ? `attempt-outcome:${attemptId}` : null, (signal) =>
    getAttemptOutcome(attemptId, signal),
  );
  const feedback = useApiQuery(finished ? `attempt-feedback:${attemptId}` : null, (signal) =>
    getSurveyFeedbackStatus(attemptId, signal),
  );
  const [stashed] = useState(() => readStashedSubmission(attemptId));
  // 401 / locked account: SessionGate redirects instead of an error with a useless retry.
  const sessionLost = useSessionLossRedirect(attempt.error, outcome.error, feedback.error);

  const unfinished = attempt.data && !finished ? attemptPath(attempt.data) : null;
  useEffect(() => {
    if (unfinished) router.replace(unfinished);
  }, [router, unfinished]);

  // Points just moved (reward, starter unlock): update the header chip once.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const loading = sessionLost || !attempt.data || Boolean(unfinished) || outcome.loading || feedback.loading;
  const view = attempt.data && finished ? resolveCompletionView(attempt.data, outcome.data ?? null, stashed) : null;

  return {
    attempt: attempt.data ?? null,
    error: sessionLost ? null : attempt.error,
    reload: attempt.reload,
    loading,
    view,
    /** null when the status could not be read: the rating form is then hidden. */
    feedbackStatus: feedback.data ?? null,
  };
}
