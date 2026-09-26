import {
  submitSurveyFeedbackInputSchema,
  submitSurveyFeedbackResultSchema,
  surveyFeedbackStatusSchema,
  type SubmitSurveyFeedbackInput,
  type SubmitSurveyFeedbackResultDto,
  type SurveyFeedbackStatusDto,
} from "@rescom/schemas";
import { formMutationFetch } from "../forms/forms-api.ts";
import {
  SURVEY_FEEDBACK_ERROR_MESSAGES,
  describeSurveyFeedbackValidationIssue,
} from "../../lib/survey-feedback.ts";

/**
 * Typed live client for the Story 9.2 feedback endpoints
 * (`GET|POST /attempts/:attemptId/feedback`). The receipts currently use the
 * mock repository; this client is the drop-in for the later backend swap.
 */

export type SurveyFeedbackApiError = Error & { code?: string; status?: number };

/** The slice of a shared Zod schema this client needs (avoids a direct zod dependency). */
interface ResponseSchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

export interface SurveyFeedbackRequestOptions {
  signal?: AbortSignal;
}

const AUTH_REQUIRED_MESSAGE = "Vui lòng đăng nhập để đánh giá khảo sát.";
const MALFORMED_MESSAGE = "Máy chủ trả về dữ liệu đánh giá không hợp lệ.";

function feedbackUrl(attemptId: string): string {
  return `/api/attempts/${encodeURIComponent(attemptId)}/feedback`;
}

async function readEnvelope<T>(
  res: Response,
  schema: ResponseSchema<T>,
  fallbackMessage: string,
): Promise<T> {
  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const code: unknown = payload?.error?.code;
    // Known codes get the same Vietnamese copy as the mock repository.
    const knownMessage =
      typeof code === "string" ? SURVEY_FEEDBACK_ERROR_MESSAGES[code] : undefined;
    const error = new Error(
      res.status === 401
        ? AUTH_REQUIRED_MESSAGE
        : knownMessage || payload?.error?.message || fallbackMessage,
    ) as SurveyFeedbackApiError;
    // Every backend 401 code means "signed out"; one code lets the prompt hide.
    error.code = res.status === 401 ? "AUTH_REQUIRED" : payload?.error?.code;
    error.status = res.status;
    throw error;
  }

  const parsed = schema.safeParse(payload?.data);
  if (!parsed.success) {
    throw new Error(MALFORMED_MESSAGE);
  }
  return parsed.data;
}

export async function fetchSurveyFeedbackStatus(
  attemptId: string,
  options: SurveyFeedbackRequestOptions = {},
): Promise<SurveyFeedbackStatusDto> {
  const res = await fetch(feedbackUrl(attemptId), {
    signal: options.signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return readEnvelope(
    res,
    surveyFeedbackStatusSchema,
    "Không thể tải trạng thái đánh giá khảo sát.",
  );
}

/**
 * Validates and normalizes the input with the shared schema before sending,
 * so an invalid rating never reaches the API.
 */
export async function submitSurveyFeedback(
  attemptId: string,
  input: SubmitSurveyFeedbackInput,
): Promise<SubmitSurveyFeedbackResultDto> {
  const parsed = submitSurveyFeedbackInputSchema.safeParse(input);
  if (!parsed.success) {
    const error = new Error(
      describeSurveyFeedbackValidationIssue(parsed.error.issues[0]?.path[0]),
    ) as SurveyFeedbackApiError;
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const res = await formMutationFetch(feedbackUrl(attemptId), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed.data),
  });
  return readEnvelope(
    res,
    submitSurveyFeedbackResultSchema,
    "Không thể gửi đánh giá khảo sát.",
  );
}
