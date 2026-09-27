"use client";

import { useCallback, useRef, useState } from "react";
import type { SurveyFeedbackDto, SurveyFeedbackIssueTag, SurveyFeedbackStatusDto } from "@rescom/schemas";
import { SURVEY_FEEDBACK_ISSUE_TAGS } from "@rescom/schemas";
import { submitSurveyFeedback } from "@/lib/participation/feedback-service";
import { feedbackErrorMessage } from "@/lib/participation/participation-messages";
import { isSessionLost } from "@/lib/session/session-status";
import { useSession } from "@/lib/session/SessionProvider";

/** Figma 6 issue chips, in the backend's canonical tag order. */
export const ISSUE_TAG_LABELS: Record<SurveyFeedbackIssueTag, string> = {
  UNCLEAR_QUESTIONS: "Câu hỏi khó hiểu",
  LONGER_THAN_ESTIMATED: "Dài hơn ước tính",
  MISLEADING_DESCRIPTION: "Mô tả không đúng",
  TECHNICAL_ISSUE: "Lỗi kỹ thuật",
};
export const ISSUE_TAGS = SURVEY_FEEDBACK_ISSUE_TAGS;

/** Rating form state (stars, issue chips, comment ≤ 500) and its submission. */
export function useFeedbackForm(attemptId: string, status: SurveyFeedbackStatusDto | null) {
  const { refresh } = useSession();
  const [rating, setRating] = useState<number | null>(null);
  const [tags, setTags] = useState<SurveyFeedbackIssueTag[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SurveyFeedbackDto | null>(status?.feedback ?? null);
  /** Double-submit guard (Enter + click, or two quick clicks before `busy` renders). */
  const busyRef = useRef(false);

  const toggleTag = useCallback((tag: SurveyFeedbackIssueTag, selected: boolean) => {
    setTags((current) => (selected ? [...current.filter((item) => item !== tag), tag] : current.filter((item) => item !== tag)));
  }, []);

  const submit = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await submitSurveyFeedback(attemptId, {
        rating: rating ?? 0,
        comment: comment.trim() ? comment : null,
        issueTags: tags,
      });
      setSent(result.feedback);
    } catch (cause) {
      // Session ended: SessionGate sends the user to login.
      if (isSessionLost(cause)) refresh();
      else setError(feedbackErrorMessage(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [attemptId, comment, rating, refresh, tags]);

  return {
    /** The form is shown only for an eligible attempt without feedback yet. */
    open: status?.state === "ELIGIBLE" && sent === null,
    sent,
    rating,
    setRating,
    tags,
    toggleTag,
    comment,
    setComment,
    busy,
    error,
    submit,
  };
}

export type FeedbackFormState = ReturnType<typeof useFeedbackForm>;
