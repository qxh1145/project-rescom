import {
  submitSurveyFeedbackInputSchema,
  submitSurveyFeedbackResultSchema,
  surveyFeedbackStatusSchema,
  type SubmitSurveyFeedbackInput,
  type SubmitSurveyFeedbackResultDto,
  type SurveyFeedbackStatusDto,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import { describeSurveyFeedbackValidationIssue } from "../survey-feedback.ts";

/**
 * Story 9.2 post-completion feedback (Figma 6 "Khảo sát này thế nào?").
 * VERIFIED: `GET|POST /attempts/:attemptId/feedback`
 * (`survey-feedback.controller.ts`; POST needs CSRF + JSON). Errors: 404
 * `FEEDBACK_ATTEMPT_NOT_FOUND`, 409 `FEEDBACK_NOT_ALLOWED`,
 * 409 `FEEDBACK_ALREADY_SUBMITTED` (an identical replay answers 200 `replayed`).
 * Migrated from `app/attempts/survey-feedback-api.ts`.
 */

export function getSurveyFeedbackStatus(attemptId: string, signal?: AbortSignal): Promise<SurveyFeedbackStatusDto> {
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}/feedback`, {
    schema: surveyFeedbackStatusSchema,
    signal,
  });
}

/** Rejected before any request: the input breaks the shared schema. */
export class SurveyFeedbackInputError extends Error {
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "SurveyFeedbackInputError";
  }
}

/** Normalizes with the shared schema (trim, canonical tag order) before sending. */
export function submitSurveyFeedback(
  attemptId: string,
  input: SubmitSurveyFeedbackInput,
  signal?: AbortSignal,
): Promise<SubmitSurveyFeedbackResultDto> {
  const parsed = submitSurveyFeedbackInputSchema.safeParse(input);
  if (!parsed.success) {
    return Promise.reject(
      new SurveyFeedbackInputError(describeSurveyFeedbackValidationIssue(parsed.error.issues[0]?.path[0])),
    );
  }
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}/feedback`, {
    method: "POST",
    body: parsed.data,
    schema: submitSurveyFeedbackResultSchema,
    signal,
  });
}
