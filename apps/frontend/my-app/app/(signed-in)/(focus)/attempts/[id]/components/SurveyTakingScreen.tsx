"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getAttempt, type AttemptDetails } from "@/lib/participation/attempts-service";
import { loadAttemptErrorMessage } from "@/lib/participation/participation-messages";
import { getSurveyForm } from "@/lib/participation/survey-form-service";
import { FocusError, FocusLoading } from "../../../_participation/FocusPageState";
import { SurveyRunnerView } from "./SurveyRunnerView";

/** Where a loaded attempt belongs when it is not an open in-Rescom attempt. */
function redirectFor(attempt: AttemptDetails): string | null {
  if (attempt.type === "EXTERNAL") return `/attempts/${attempt.attemptId}/google-form`;
  if (attempt.status === "SUBMITTED" || attempt.status === "PENDING_REVIEW") {
    return `/attempts/${attempt.attemptId}/complete`;
  }
  return null;
}

/** `/attempts/:id` — loads the attempt and its questions, then hands over to the runner. */
export function SurveyTakingScreen() {
  const params = useParams<{ id: string }>();
  const attemptId = String(params.id);
  const router = useRouter();
  const attempt = useApiQuery(`attempt:${attemptId}`, (signal) => getAttempt(attemptId, signal));
  const target = attempt.data ? redirectFor(attempt.data) : null;
  const closed = attempt.data?.status === "LOCKED" || attempt.data?.status === "CANCELLED";
  const formId = attempt.data && !target && !closed ? attempt.data.formId : null;
  const form = useApiQuery(formId ? `survey-form:${formId}` : null, (signal) => getSurveyForm(formId ?? "", signal));

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

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

  return <SurveyRunnerView key={attempt.data.attemptId} attempt={attempt.data} form={form.data} />;
}
