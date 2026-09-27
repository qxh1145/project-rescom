import {
  reportMissingCompletionCodeResponseSchema,
  verifyExternalCompletionCodeResponseSchema,
  type ReportMissingCompletionCodeResponseDto,
  type VerifyExternalCompletionCodeResponseDto,
} from "@rescom/schemas";
import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Google Forms completion-code routes (`participation.controller.ts`,
 * session + CsrfGuard + JsonOnlyGuard). The attempt-scoped aliases are used
 * because the screen only knows the attempt id.
 */

/**
 * VERIFIED: `POST /attempts/:attemptId/verify-code`, body
 * `verifyExternalCompletionCodeInputSchema` → 200
 * `verifyExternalCompletionCodeResponseSchema` (reward PENDING, 48h window).
 * Errors (`http-exception.filter.ts`): 400 INVALID_COMPLETION_CODE
 * (`details.remainingAttempts`), 409 ATTEMPT_LOCKED, 409
 * COMPLETION_CODE_LIMIT_REACHED, 422 SUBMISSION_TOO_FAST
 * (`timeBarrierRejectionDetailsSchema`), 409 ATTEMPT_EXPIRED, 404
 * SURVEY_NOT_AVAILABLE, 400 ATTEMPT_NOT_EXTERNAL / VALIDATION_ERROR, 429
 * PARTICIPATION_RATE_LIMITED. A retry after success replays the result.
 */
export function verifyCompletionCode(
  attemptId: string,
  completionCode: string,
  signal?: AbortSignal,
): Promise<VerifyExternalCompletionCodeResponseDto> {
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}/verify-code`, {
    method: "POST",
    body: { completionCode },
    schema: verifyExternalCompletionCodeResponseSchema,
    signal,
  });
}

/**
 * VERIFIED: `POST /attempts/:attemptId/report-missing-code`, body
 * `{ reason }` (5–1000 chars) → 200 `reportMissingCompletionCodeResponseSchema`.
 * Errors: 409 ATTEMPT_LOCKED (the backend refuses LOCKED attempts — see the
 * Figma 5c gap in the Phase 3C report), 409 SURVEY_ALREADY_COMPLETED,
 * 409 ATTEMPT_EXPIRED (abandoned), 400 VALIDATION_ERROR.
 */
export function reportMissingCode(
  attemptId: string,
  reason: string,
  signal?: AbortSignal,
): Promise<ReportMissingCompletionCodeResponseDto> {
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}/report-missing-code`, {
    method: "POST",
    body: { reason: reason.trim() },
    schema: reportMissingCompletionCodeResponseSchema,
    signal,
  });
}

/**
 * ASSUMED API CONTRACT: `POST /attempts/:attemptId/cancel` ("Huỷ lượt làm").
 * The backend has an ABANDONED attempt status but no route to abandon one.
 * → 200 `{ attemptId, status: "CANCELLED" }`; 409 ATTEMPT_NOT_IN_PROGRESS.
 */
export const cancelAttemptResponseSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.literal("CANCELLED"),
});

export function cancelAttempt(attemptId: string, signal?: AbortSignal) {
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}/cancel`, {
    method: "POST",
    body: {},
    schema: cancelAttemptResponseSchema,
    signal,
  });
}
