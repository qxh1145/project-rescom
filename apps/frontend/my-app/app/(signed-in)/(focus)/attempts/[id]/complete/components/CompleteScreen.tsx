"use client";

import { useParams } from "next/navigation";
import { loadAttemptErrorMessage } from "@/lib/participation/participation-messages";
import { FocusError, FocusLoading } from "../../../../_participation/FocusPageState";
import { useCompletion } from "../hooks/use-completion";
import { HeldView } from "./HeldView";
import { SuccessView } from "./SuccessView";

/** `/attempts/:id/complete` — Figma 6 success + rating, or 17c when the reward is held. */
export function CompleteScreen() {
  const params = useParams<{ id: string }>();
  const attemptId = String(params.id);
  const completion = useCompletion(attemptId);

  if (completion.error) {
    return <FocusError message={loadAttemptErrorMessage(completion.error)} onRetry={completion.reload} />;
  }
  if (completion.loading || !completion.attempt || !completion.view) return <FocusLoading />;

  const { attempt, view } = completion;
  if (view.kind === "held") {
    return <HeldView amount={view.amount} surveyTitle={attempt.survey.title} submittedAt={view.submittedAt} />;
  }
  return (
    <SuccessView
      attemptId={attempt.attemptId}
      surveyTitle={attempt.survey.title}
      view={{ ...view, kind: view.kind }}
      feedbackStatus={completion.feedbackStatus}
    />
  );
}
