import {
  attemptStatusSchema,
  conflictingActiveAttemptDetailsSchema,
  surveyAttemptDetailsSchema,
  surveyAttemptResponseSchema,
  type AttemptPinnedFormDto,
  type AttemptStatus,
  type ConflictingActiveAttemptDetails,
  type SurveyAttemptDetailsDto,
  type SurveyAttemptResponseDto,
} from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";
import { apiRequest } from "../api/client.ts";
import { rememberStorageCapability } from "./file-upload-service.ts";

/**
 * VERIFIED: `POST /surveys/:id/attempts` (`participation.controller.ts`,
 * CsrfGuard + JsonOnlyGuard) → 201 `surveyAttemptResponseSchema`.
 * Errors (`participation.exceptions.ts`): 409 `SURVEY_ALREADY_COMPLETED`,
 * 409 `SURVEY_QUOTA_FULL`, 409 `CONFLICTING_ACTIVE_ATTEMPT` (details = the
 * caller's own active attempt, so it can be resumed), `SURVEY_NOT_AVAILABLE`,
 * 403 `DEMOGRAPHIC_PROFILE_REQUIRED`, 429 rate limits.
 *
 * Shared by the in-Rescom flow and the Google Forms flow — extend, don't fork.
 */
export async function startSurveyAttempt(surveyId: string, signal?: AbortSignal): Promise<SurveyAttemptResponseDto> {
  const attempt = await apiRequest(`/surveys/${encodeURIComponent(surveyId)}/attempts`, {
    method: "POST",
    body: {},
    schema: surveyAttemptResponseSchema,
    signal,
  });
  // File-upload questions send it with every storage call (`file-upload-service.ts`).
  rememberStorageCapability(attempt.attemptId, attempt.storageCapability);
  return attempt;
}

/** The active attempt to resume when starting fails with CONFLICTING_ACTIVE_ATTEMPT. */
export function conflictingAttemptOf(error: unknown): ConflictingActiveAttemptDetails | null {
  if (!isApiError(error) || error.code !== "CONFLICTING_ACTIVE_ATTEMPT") return null;
  const parsed = conflictingActiveAttemptDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

/**
 * VERIFIED: `GET /attempts/:attemptId` (`survey-runner.controller.ts`,
 * owner-only, `Cache-Control: no-store`) → `surveyAttemptDetailsSchema`
 * (strict): the attempt as persisted, its server times and barrier, a survey
 * header (`survey.status` drives the "survey updated/closed" panel) and, for
 * an in-Rescom survey, the Form Definition of the PINNED version (`form`).
 * Unknown, guest and other users' attempts: 404 `ATTEMPT_NOT_FOUND`.
 *
 * `status` is the backend `AttemptStatus`. An expired reservation stays
 * `IN_PROGRESS` (reads never write); a cancel or a lazy expiry makes it
 * `ABANDONED` with `closedReason` — `attemptPhase` tells them apart.
 */
export { attemptStatusSchema, surveyAttemptDetailsSchema };
export type { AttemptStatus };
export type AttemptDetails = SurveyAttemptDetailsDto;
/** The pinned Form Definition the in-Rescom runner renders. */
export type AttemptPinnedForm = AttemptPinnedFormDto;

/** What an attempt means for the screens, from the backend status + time. */
export type AttemptPhase = "open" | "expired" | "cancelled" | "locked" | "completed";

export function attemptPhase(
  attempt: Pick<AttemptDetails, "status" | "expiresAt"> & { closedReason?: AttemptDetails["closedReason"] },
  nowMs: number = Date.now(),
): AttemptPhase {
  const expired = Date.parse(attempt.expiresAt) <= nowMs;
  switch (attempt.status) {
    case "COMPLETED":
      return "completed";
    case "LOCKED":
      return "locked";
    case "ABANDONED":
      if (attempt.closedReason === "CANCELLED") return "cancelled";
      if (attempt.closedReason === "EXPIRED") return "expired";
      // Rows abandoned before `closedReason` existed: the reservation window decides.
      return expired ? "expired" : "cancelled";
    default:
      return expired ? "expired" : "open";
  }
}

export function getAttempt(attemptId: string, signal?: AbortSignal): Promise<AttemptDetails> {
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}`, { schema: surveyAttemptDetailsSchema, signal });
}
