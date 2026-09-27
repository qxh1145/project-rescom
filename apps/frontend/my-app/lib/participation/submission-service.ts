import {
  internalFormSubmissionResponseSchema,
  ledgerAccountClassSchema,
  rewardSettlementStatusSchema,
  type BlockAnswer,
  type InternalFormSubmissionResponseDto,
} from "@rescom/schemas";
import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * VERIFIED: `POST /responses/:responseId/submit` (`participation.controller.ts`,
 * OptionalSessionCsrfGuard + JsonOnlyGuard) → 200
 * `internalFormSubmissionResponseSchema`. Errors: 400 `INVALID_FORM_SUBMISSION`
 * (details = errors by block id), 404 `RESPONSE_NOT_FOUND`, 409
 * `ATTEMPT_EXPIRED`, 422 `SUBMISSION_TOO_FAST` (time barrier details),
 * 429 `PARTICIPATION_RATE_LIMITED`.
 */
export function submitSurveyResponse(
  responseId: string,
  input: { attemptId: string; answers: BlockAnswer[] },
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
 * ASSUMED API CONTRACT: `GET /attempts/:attemptId/outcome` — the reward state
 * of a finished attempt, so `/attempts/:id/complete` survives a reload and
 * also serves Google Forms attempts. `accountActivated` = this attempt
 * unlocked the frozen starter points (Figma 6 "Tài khoản đã kích hoạt"); the
 * submit response has no such flag.
 */
export const attemptOutcomeSchema = z.object({
  attemptId: z.string().uuid(),
  reward: z
    .object({
      status: rewardSettlementStatusSchema,
      amount: z.number().int().nonnegative(),
      targetAccountClass: ledgerAccountClassSchema.nullable(),
    })
    .nullable(),
  accountActivated: z.boolean(),
  submittedAt: z.string().datetime().nullable(),
});
export type AttemptOutcome = z.infer<typeof attemptOutcomeSchema>;

export function getAttemptOutcome(attemptId: string, signal?: AbortSignal): Promise<AttemptOutcome> {
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}/outcome`, { schema: attemptOutcomeSchema, signal });
}

/**
 * The submit response is kept in sessionStorage for the completion screen:
 * it is the only VERIFIED source of the reward state until the outcome route
 * exists.
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
