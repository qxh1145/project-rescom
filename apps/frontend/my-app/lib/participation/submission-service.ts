import {
  attemptOutcomeSchema,
  internalFormSubmissionResponseSchema,
  type AttemptOutcomeDto,
  type InternalFormSubmissionResponseDto,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import type { SubmissionAnswers } from "./survey-form.ts";

/**
 * VERIFIED: `POST /responses/:responseId/submit` (`participation.controller.ts`,
 * OptionalSessionCsrfGuard + JsonOnlyGuard), `answers` as a record by block
 * id (`toSubmissionAnswers`; file questions carry CLEAN attachments) → 200
 * `internalFormSubmissionResponseSchema`. Errors: 400 `INVALID_FORM_SUBMISSION`
 * (details = errors by block id), 404 `RESPONSE_NOT_FOUND`, 409
 * `ATTEMPT_EXPIRED`, 422 `SUBMISSION_TOO_FAST` (time barrier details),
 * 400 `UNCLEAN_ATTACHMENT` (a file is not a CLEAN upload of this attempt),
 * 429 `PARTICIPATION_RATE_LIMITED`.
 */
export function submitSurveyResponse(
  responseId: string,
  input: { attemptId: string; answers: SubmissionAnswers },
  signal?: AbortSignal,
): Promise<InternalFormSubmissionResponseDto> {
  return apiRequest(`/responses/${encodeURIComponent(responseId)}/submit`, {
    method: "POST",
    body: { attemptId: input.attemptId, answers: input.answers },
    schema: internalFormSubmissionResponseSchema,
    signal,
  });
}

/**
 * VERIFIED: `GET /attempts/:attemptId/outcome` (`survey-runner.controller.ts`,
 * owner-only, read-only) → `attemptOutcomeSchema` (strict): `reward.state`
 * derived from the posted ledger journals (AVAILABLE, PENDING with
 * `releasesAt`, HELD_IN_INTEGRITY, HELD_IN_DISPUTE, REVERSED,
 * AWAITING_SETTLEMENT, NO_REWARD, NOT_COMPLETED), the credited `amount`, and
 * whether THIS attempt unlocked the frozen starter points
 * (`starterUnlock.activatedByThisAttempt`, mirrored by `accountActivated`,
 * Figma 6 "Tài khoản đã kích hoạt"). Lets `/attempts/:id/complete` survive a
 * reload for in-Rescom and Google Forms attempts.
 */
export { attemptOutcomeSchema };
export type AttemptOutcome = AttemptOutcomeDto;

export function getAttemptOutcome(attemptId: string, signal?: AbortSignal): Promise<AttemptOutcome> {
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}/outcome`, { schema: attemptOutcomeSchema, signal });
}

/**
 * The submit response is kept in sessionStorage for the completion screen:
 * the reward state survives an outcome read that fails (offline, slow).
 */
const STASH_PREFIX = "rescom:survey-submission:";

function sessionStore(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function stashSubmission(result: InternalFormSubmissionResponseDto): void {
  try {
    sessionStore()?.setItem(`${STASH_PREFIX}${result.attemptId}`, JSON.stringify(result));
  } catch {
    // Best effort: the completion screen falls back to the outcome route.
  }
}

export function readStashedSubmission(attemptId: string): InternalFormSubmissionResponseDto | null {
  try {
    const raw = sessionStore()?.getItem(`${STASH_PREFIX}${attemptId}`);
    if (!raw) return null;
    const parsed = internalFormSubmissionResponseSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
