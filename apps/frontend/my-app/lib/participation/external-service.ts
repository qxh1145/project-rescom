import {
  IDEMPOTENCY_KEY_HEADER,
  cancelAttemptResponseSchema,
  reportMissingCompletionCodeResponseSchema,
  verifyExternalCompletionCodeResponseSchema,
  type CancelAttemptResponseDto,
  type ReportMissingCompletionCodeResponseDto,
  type VerifyExternalCompletionCodeResponseDto,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import { randomUuid } from "../random-uuid.ts";

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
 * VERIFIED: `POST /attempts/:attemptId/cancel` ("Huỷ lượt làm";
 * `survey-runner.controller.ts`, CsrfGuard + JsonOnlyGuard), body `{}` and a
 * required `Idempotency-Key` (one per user confirmation, reused on retry) →
 * 200 `cancelAttemptResponseSchema` (ABANDONED / CANCELLED with `closedAt`;
 * a replay returns the original `closedAt`). Errors: 409
 * ATTEMPT_NOT_IN_PROGRESS (`attemptNotInProgressDetailsSchema`: completed,
 * locked, otherwise abandoned or expired), 404 ATTEMPT_NOT_FOUND, 400
 * INVALID_IDEMPOTENCY_KEY. Both attempt types. Errors map to UI states in
 * `cancelFailureOf` (`external-code.ts`).
 */
export { cancelAttemptResponseSchema };

export function cancelAttempt(
  attemptId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<CancelAttemptResponseDto> {
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}/cancel`, {
    method: "POST",
    body: {},
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    schema: cancelAttemptResponseSchema,
    signal,
  });
}

/**
 * One key per "Huỷ lượt làm" confirmation (`idempotencyKeySchema`: a UUID
 * fits). `randomUuid` also works on a non-secure origin (http LAN IP).
 */
export function newCancelIdempotencyKey(): string {
  return randomUuid();
}
