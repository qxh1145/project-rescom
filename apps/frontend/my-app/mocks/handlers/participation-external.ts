import { http } from "msw";
import {
  ATTEMPT_NOT_FOUND_CODE,
  ATTEMPT_NOT_IN_PROGRESS_CODE,
  COMPLETION_CODE_LIMIT_REACHED_CODE,
  COMPLETION_CODE_POLICY,
  COMPLETION_CODE_POLICY_VERSION,
  IDEMPOTENCY_KEY_HEADER,
  RESERVATION_EXPIRY_MS,
  SUBMISSION_TOO_FAST_CODE,
  TIME_BARRIER_POLICY_VERSION,
  evaluateTimeBarrier,
  cancelAttemptRequestSchema,
  idempotencyKeySchema,
  remainingCompletionCodeTries,
  reportMissingCompletionCodeInputSchema,
  verifyExternalCompletionCodeInputSchema,
  type AttemptNotInProgressDetails,
  type CancelAttemptResponseDto,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import {
  accountWrongCodeCount,
  externalBarrierSecondsOf,
  findAttempt,
  updateAttempt,
  type MockAttempt,
} from "../data/attempts";
import { addMissingCodeReport } from "../data/admin-disputes";
import { creditSurveyReward } from "../data/economy";
import { updateNotifications } from "../data/notifications";
import { findSurvey, markSurveyCompleted, updateSurvey } from "../data/surveys";
import { mockId, nowIso } from "../db/store";
import { getMockSessionUser, type MockSessionUser } from "../db/session";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Google Forms completion code (Figma page 5). Mirrors the attempt-scoped
 * routes of `participation.controller.ts` and the order of checks in
 * `ParticipationService.verifyExternalCompletionCode`:
 * replay → locked → expired → time barrier → account limit → code.
 */

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

type Guarded = { user: MockSessionUser; attempt: MockAttempt } | { response: Response };

/** Session, CSRF, ownership and EXTERNAL type — the backend answers 404/403/400 like this. */
async function guard(request: Request, attemptId: string, requireExternal = true): Promise<Guarded> {
  const user = await getMockSessionUser();
  if (!user) return { response: unauthorized() };
  const csrf = missingCsrf(request);
  if (csrf) return { response: csrf };
  const attempt = findAttempt(attemptId);
  if (!attempt) return { response: fail(404, "SURVEY_NOT_AVAILABLE", "Survey attempt not found.") };
  if (attempt.userId !== user.id) {
    return { response: fail(403, "PARTICIPANT_NOT_ELIGIBLE", "Unauthorized attempt access.") };
  }
  if (requireExternal && attempt.type !== "EXTERNAL") {
    return { response: fail(400, "ATTEMPT_NOT_EXTERNAL", "This attempt is not an external survey attempt.") };
  }
  return { user, attempt };
}

function cancelledDto(attempt: MockAttempt): CancelAttemptResponseDto {
  return {
    attemptId: attempt.attemptId,
    status: "ABANDONED",
    closedReason: "CANCELLED",
    closedAt: attempt.closedAt ?? attempt.startedAt,
  };
}

function isExpired(attempt: MockAttempt): boolean {
  return Date.now() > Date.parse(attempt.startedAt) + RESERVATION_EXPIRY_MS;
}

/** Wrong codes of this user on the attempt's FormVersion (decision E5-D1). */
function accountFailuresOf(attempt: MockAttempt): number {
  return accountWrongCodeCount(attempt.userId, attempt.formVersionId);
}

function completionDto(attempt: MockAttempt, amount: number) {
  const completedAt = attempt.submittedAt ?? nowIso();
  return {
    attemptId: attempt.attemptId,
    formId: attempt.surveyId,
    formVersionId: attempt.formVersionId,
    status: "COMPLETED" as const,
    completedAt,
    reward: {
      status: "PENDING" as const,
      journalId: mockId(),
      amount,
      targetAccountClass: "PENDING" as const,
      settledAt: completedAt,
    },
    message: `Completion code verified successfully! +${amount} points credited to Pending balance (48-hour dispute window).`,
  };
}

export const externalParticipationHandlers = [
  // VERIFIED: POST /attempts/:attemptId/verify-code
  http.post(apiUrl("/attempts/:attemptId/verify-code"), async ({ request, params }) => {
    const forced = await applyScenario("participation");
    if (forced) return forced;
    const guarded = await guard(request, String(params.attemptId));
    if ("response" in guarded) return guarded.response;
    const { user, attempt } = guarded;

    const body = verifyExternalCompletionCodeInputSchema.safeParse(await readJson(request));
    if (!body.success) {
      return fail(400, "VALIDATION_ERROR", body.error.errors[0]?.message ?? "Validation failed", {
        details: body.error.format(),
      });
    }

    const survey = findSurvey(attempt.surveyId);
    if (attempt.status === "COMPLETED") {
      return ok(completionDto(attempt, survey?.rewardPerResponse ?? 0)); // idempotent replay
    }
    if (attempt.status === "LOCKED") {
      return fail(409, "ATTEMPT_LOCKED", "This survey attempt is locked due to too many failed completion code attempts.");
    }
    if (attempt.status === "ABANDONED") {
      return fail(409, "ATTEMPT_EXPIRED", "Survey attempt was abandoned and can no longer be completed.");
    }
    if (isExpired(attempt)) {
      return fail(409, "ATTEMPT_EXPIRED", "Survey attempt reservation has expired. Please start a new attempt.");
    }
    if (!survey || survey.status !== "PUBLISHED") {
      return fail(404, "SURVEY_NOT_AVAILABLE", "Survey is not published or active for completions.");
    }

    const requiredSeconds = externalBarrierSecondsOf(attempt);
    const timing = evaluateTimeBarrier({ startedAt: attempt.startedAt, requiredSeconds });
    if (!timing.passed) {
      return fail(422, SUBMISSION_TOO_FAST_CODE, "Submission is too fast.", {
        details: {
          requiredSeconds,
          elapsedSeconds: timing.elapsedSeconds,
          remainingSeconds: timing.remainingSeconds,
          retryAfterSeconds: timing.remainingSeconds,
          earliestSubmitAt: timing.earliestSubmitAt,
          questionCount: null,
          secondsPerQuestion: null,
          publisherMinimumSeconds: requiredSeconds,
          policyVersion: TIME_BARRIER_POLICY_VERSION,
        },
        headers: { "Retry-After": String(timing.remainingSeconds) },
      });
    }

    const accountFailures = accountFailuresOf(attempt);
    if (accountFailures >= COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion) {
      return fail(409, COMPLETION_CODE_LIMIT_REACHED_CODE, "You have used every completion-code try for this survey version.", {
        details: {
          formVersionId: attempt.formVersionId,
          failedVerifications: accountFailures,
          limit: COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion,
          policyVersion: COMPLETION_CODE_POLICY_VERSION,
        },
      });
    }

    if (body.data.completionCode !== attempt.completionCode) {
      const updated = updateAttempt(attempt.attemptId, (target) => {
        target.wrongCodeCount += 1;
        if (target.wrongCodeCount >= COMPLETION_CODE_POLICY.maxFailuresPerAttempt) target.status = "LOCKED";
      });
      if (!updated || updated.status === "LOCKED") {
        return fail(409, "ATTEMPT_LOCKED", "This survey attempt is locked due to too many failed completion code attempts.");
      }
      const remainingAttempts = remainingCompletionCodeTries({
        attemptFailures: updated.wrongCodeCount,
        accountFailures: accountFailures + 1,
      });
      return fail(
        400,
        "INVALID_COMPLETION_CODE",
        `Invalid completion code. ${remainingAttempts} attempts remaining before attempt is locked.`,
        { details: { remainingAttempts } },
      );
    }

    const completed = updateAttempt(attempt.attemptId, (target) => {
      target.status = "COMPLETED";
      target.submittedAt = nowIso();
    });
    markSurveyCompleted(user.id, user.email, survey.id);
    updateSurvey(survey.id, (target) => {
      target.completedCompletions = Math.min(target.expectedCompletions, target.completedCompletions + 1);
    });
    creditSurveyReward(user, {
      amount: survey.rewardPerResponse,
      pending: true,
      surveyId: survey.id,
      attemptId: attempt.attemptId,
      title: survey.title,
    });
    updateNotifications(user.id, (items) => {
      items.unshift({
        id: mockId(),
        type: "REWARD_PENDING",
        message: `+${survey.rewardPerResponse} điểm đang chờ 48 giờ: Từ “${survey.title}”. Còn 48 giờ trước khi vào Khả dụng.`,
        isRead: false,
        createdAt: nowIso(),
        readAt: null,
      });
    });
    return ok(completionDto(completed ?? attempt, survey.rewardPerResponse));
  }),

  // VERIFIED: POST /attempts/:attemptId/report-missing-code
  http.post(apiUrl("/attempts/:attemptId/report-missing-code"), async ({ request, params }) => {
    const forced = await applyScenario("participation");
    if (forced) return forced;
    const guarded = await guard(request, String(params.attemptId));
    if ("response" in guarded) return guarded.response;
    const { attempt } = guarded;

    const body = reportMissingCompletionCodeInputSchema.safeParse(await readJson(request));
    if (!body.success) {
      return fail(400, "VALIDATION_ERROR", body.error.errors[0]?.message ?? "Validation failed", {
        details: body.error.format(),
      });
    }
    // The backend answers 409 ATTEMPT_LOCKED here. ASSUMED: Figma 5c ("Báo Admin
    // kiểm tra" on a locked attempt) needs the report accepted, so the mock
    // accepts it — the UI still maps ATTEMPT_LOCKED if the backend keeps refusing.
    if (attempt.status === "COMPLETED") {
      return fail(409, "SURVEY_ALREADY_COMPLETED", "This survey attempt is already completed.");
    }
    if (attempt.status === "ABANDONED") {
      return fail(409, "ATTEMPT_EXPIRED", "This survey attempt was abandoned.");
    }
    addMissingCodeReport({ attemptId: attempt.attemptId, reason: body.data.reason });
    return ok({
      attemptId: attempt.attemptId,
      reportedAt: nowIso(),
      status: "REPORTED" as const,
      message:
        "Your report has been submitted to RESCOM admin for review. Admins will investigate and compensate missing points within 24 working hours.",
    });
  }),

  // VERIFIED: POST /attempts/:attemptId/cancel (`survey-runner.controller.ts`) → cancelAttemptResponseSchema
  // ("Huỷ lượt làm"; also the in-Rescom "bắt đầu lại" after a survey update). Both types.
  http.post(apiUrl("/attempts/:attemptId/cancel"), async ({ request, params }) => {
    const forced = await applyScenario("participation");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const body = cancelAttemptRequestSchema.safeParse(await readJson(request));
    if (!body.success) {
      return fail(400, "VALIDATION_ERROR", body.error.errors[0]?.message ?? "Validation failed", {
        details: body.error.format(),
      });
    }
    const key = idempotencyKeySchema.safeParse(request.headers.get(IDEMPOTENCY_KEY_HEADER) ?? "");
    if (!key.success) {
      return fail(400, "INVALID_IDEMPOTENCY_KEY", key.error.errors[0]?.message ?? "Invalid Idempotency-Key");
    }
    const attempt = findAttempt(String(params.attemptId));
    // Unknown and other users' attempts are one 404 (owner-only route).
    if (!attempt || attempt.userId !== user.id) {
      return fail(404, ATTEMPT_NOT_FOUND_CODE, "Survey attempt not found.");
    }
    // A replay (any key) returns the original closing time.
    if (attempt.status === "ABANDONED" && attempt.closedReason === "CANCELLED") {
      return ok(cancelledDto(attempt));
    }
    if (attempt.status !== "IN_PROGRESS" || isExpired(attempt)) {
      const details: AttemptNotInProgressDetails = {
        status: attempt.status,
        closedReason: attempt.status === "IN_PROGRESS" || attempt.closedReason === "EXPIRED" ? "EXPIRED" : null,
      };
      return fail(409, ATTEMPT_NOT_IN_PROGRESS_CODE, "Only an in-progress survey attempt can be cancelled.", {
        details,
      });
    }
    const cancelled = updateAttempt(attempt.attemptId, (target) => {
      target.status = "ABANDONED";
      target.closedReason = "CANCELLED";
      target.closedAt = nowIso();
    });
    return ok(cancelledDto(cancelled ?? attempt));
  }),
];
