import {
  attemptTimeBarrierSchema,
  conflictingActiveAttemptDetailsSchema,
  rewardSettlementStatusSchema,
  surveyAttemptResponseSchema,
  type ConflictingActiveAttemptDetails,
  type SurveyAttemptResponseDto,
} from "@rescom/schemas";
import { z } from "zod";
import { isApiError } from "../api/api-error.ts";
import { apiRequest } from "../api/client.ts";

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
export function startSurveyAttempt(surveyId: string, signal?: AbortSignal): Promise<SurveyAttemptResponseDto> {
  return apiRequest(`/surveys/${encodeURIComponent(surveyId)}/attempts`, {
    method: "POST",
    body: {},
    schema: surveyAttemptResponseSchema,
    signal,
  });
}

/** The active attempt to resume when starting fails with CONFLICTING_ACTIVE_ATTEMPT. */
export function conflictingAttemptOf(error: unknown): ConflictingActiveAttemptDetails | null {
  if (!isApiError(error) || error.code !== "CONFLICTING_ACTIVE_ATTEMPT") return null;
  const parsed = conflictingActiveAttemptDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

/**
 * ASSUMED API CONTRACT: `GET /attempts/:attemptId` — the backend has no read
 * route for an attempt yet; screens need it to survive a reload. Shape mirrors
 * `surveyAttemptResponseSchema` plus a survey summary for the headers.
 *
 * `status` uses the backend `AttemptStatus` values (VERIFIED:
 * `prisma/schema.prisma`, `survey-attempt.entity.ts`). An expired reservation
 * stays `IN_PROGRESS` until the backend lazily marks it `ABANDONED`; a
 * cancelled attempt is `ABANDONED` too — `attemptPhase` tells them apart.
 */
export const attemptStatusSchema = z.enum(["IN_PROGRESS", "COMPLETED", "ABANDONED", "LOCKED"]);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

export const attemptDetailsSchema = z.object({
  attemptId: z.string().uuid(),
  responseId: z.string().uuid().nullable(),
  formId: z.string().uuid(),
  formVersionId: z.string().uuid(),
  /**
   * ASSUMED: `versionNumber` of the pinned FormVersion (`formVersionId`), so
   * the in-Rescom runner can detect that `GET /public/forms/:id` now serves a
   * newer version. Absent → no check.
   */
  versionNumber: z.number().int().positive().nullable().optional(),
  type: z.enum(["INTERNAL", "EXTERNAL"]),
  status: attemptStatusSchema,
  /**
   * ASSUMED: reward state of a `COMPLETED` attempt — `PENDING` (Google Forms,
   * 48h review), `HELD_IN_INTEGRITY` (quality review), `SETTLED`. Kept apart
   * from `status`, which the backend does not extend for reward states.
   */
  rewardStatus: rewardSettlementStatusSchema.nullable().optional(),
  /** ASSUMED: why an `ABANDONED` attempt closed. Absent → derived from `expiresAt`. */
  closedReason: z.enum(["EXPIRED", "CANCELLED"]).nullable().optional(),
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  submittedAt: z.string().datetime().nullable(),
  wrongCodeCount: z.number().int().nonnegative(),
  /**
   * ASSUMED: wrong codes of this account on the attempt's FormVersion, summed
   * across attempts (decision E5-D1). Lets a reload tell "attempt tries left"
   * from "account budget used up". Absent → unknown.
   */
  accountWrongCodeCount: z.number().int().nonnegative().optional(),
  /**
   * Same barrier the start response announces (VERIFIED `attemptTimeBarrierSchema`);
   * ASSUMED on this read route. Absent → derive from `startedAt` (see
   * `barrierDeadlineMs` in `external-code.ts`).
   */
  timeBarrier: attemptTimeBarrierSchema.nullable().optional(),
  survey: z.object({
    title: z.string(),
    rewardPerResponse: z.number().int().nonnegative(),
    estimatedEffortSeconds: z.number().int().nonnegative(),
    publisherName: z.string(),
    externalUrl: z.string().url().nullable(),
  }),
});
export type AttemptDetails = z.infer<typeof attemptDetailsSchema>;

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
      return expired ? "expired" : "cancelled";
    default:
      return expired ? "expired" : "open";
  }
}

export function getAttempt(attemptId: string, signal?: AbortSignal): Promise<AttemptDetails> {
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}`, { schema: attemptDetailsSchema, signal });
}
