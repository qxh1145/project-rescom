import type {
  InternalFormSubmissionInput,
  InternalFormSubmissionResponseDto,
} from "@rescom/schemas";
import { formMutationFetch } from "../forms/forms-api.ts";

/**
 * Story 8.2 live participation client additions (bot protection).
 *
 * Code-review decision E8-D5 (option B, 2026-09-26): the human-owned
 * mock-journey spec keeps the existing live adapter `participation-api.ts`
 * untouched for the deferred API swap, so the 8.2 additions live here
 * instead: the Internal submission call and the bot-protection-aware error
 * shape. `toParticipationApiError` is exported so the live swap can adopt the
 * same shape for attempt start / code verification.
 *
 * Not used by the mock-first respondent journey (it never calls the live
 * backend); pages render these errors with `getParticipationGuard` from
 * `lib/participation-guards.ts`.
 */

/**
 * Error thrown by the live participation client. `code`/`details` carry the
 * backend envelope; `retryAfterSeconds` comes from the `Retry-After` header of
 * the Story 8.2 bot-protection rejections (422 SUBMISSION_TOO_FAST,
 * 429 PARTICIPATION_RATE_LIMITED).
 */
export type ParticipationApiError = Error & {
  code?: string;
  details?: unknown;
  status?: number;
  retryAfterSeconds?: number;
};

/** Builds a `ParticipationApiError` from a failed participation response. */
export async function toParticipationApiError(
  res: Response,
  fallbackMessage: string,
): Promise<ParticipationApiError> {
  const payload = await res.json().catch(() => ({}));
  const error = new Error(
    payload?.error?.message || payload?.message || fallbackMessage,
  ) as ParticipationApiError;
  error.code = payload?.error?.code;
  error.details = payload?.error?.details;
  error.status = res.status;
  const retryAfter = Number(res.headers?.get?.("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    error.retryAfterSeconds = retryAfter;
  }
  return error;
}

/**
 * Story 5.4 / 8.2: submits an Internal Form response. The server enforces the
 * Time Barrier from its own attempt start time; a too-fast submission returns
 * `SUBMISSION_TOO_FAST` (attempt kept, retry after `retryAfterSeconds`).
 */
export async function submitInternalResponse(
  responseId: string,
  input: InternalFormSubmissionInput,
): Promise<InternalFormSubmissionResponseDto> {
  const res = await formMutationFetch(`/api/responses/${responseId}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw await toParticipationApiError(res, "Failed to submit survey response");
  }

  const payload = await res.json().catch(() => ({}));
  return payload.data as InternalFormSubmissionResponseDto;
}
