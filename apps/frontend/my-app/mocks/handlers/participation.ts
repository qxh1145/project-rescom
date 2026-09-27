import { http } from "msw";
import {
  COMPLETION_CODE_LIMIT_REACHED_CODE,
  COMPLETION_CODE_POLICY,
  COMPLETION_CODE_POLICY_VERSION,
  isCompletionCodeLimitReached,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import {
  accountWrongCodeCount,
  activeAttemptOf,
  activeReservationCount,
  createAttempt,
  findAttempt,
  mockTimeBarrierOf,
  type MockAttempt,
} from "../data/attempts";
import { releaseDuePendingRewards, rewardOutcomeOf } from "../data/economy";
import { completedSurveyIdsOf, findSurvey } from "../data/surveys";
import { getMockSessionUser } from "../db/session";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Mirrors `participation.controller.ts` → `POST /surveys/:id/attempts`.
 * The in-Rescom and Google Forms phases add their own handler files for the
 * remaining participation routes (submit, verify-code, …) and reuse
 * `mocks/data/attempts.ts`.
 */
function toAttemptDto(attempt: MockAttempt, externalUrl: string | null) {
  return {
    attemptId: attempt.attemptId,
    responseId: attempt.responseId,
    formId: attempt.surveyId,
    formVersionId: attempt.formVersionId,
    type: attempt.type,
    status: "IN_PROGRESS" as const,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    externalUrl: attempt.type === "EXTERNAL" ? externalUrl : null,
    storageCapability: `mock-capability-${attempt.attemptId}`,
    // VERIFIED: the backend announces the barrier on start (Google Forms: mock 4:12).
    ...(attempt.type === "EXTERNAL" ? { timeBarrier: mockTimeBarrierOf(attempt) } : {}),
  };
}

export const participationHandlers = [
  http.post(apiUrl("/surveys/:id/attempts"), async ({ request, params }) => {
    const forced = await applyScenario("participation");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    if (!user.profileComplete) {
      return fail(403, "DEMOGRAPHIC_PROFILE_REQUIRED", "Complete your demographic profile first.");
    }

    const survey = findSurvey(String(params.id));
    // `http-exception.filter.ts` maps SurveyNotAvailableException to 404.
    if (!survey || survey.status !== "PUBLISHED") {
      return fail(404, "SURVEY_NOT_AVAILABLE", "Survey is not available for participation.");
    }
    if (completedSurveyIdsOf(user.id, user.email).includes(survey.id)) {
      return fail(409, "SURVEY_ALREADY_COMPLETED", "You have already completed this survey.");
    }
    const active = activeAttemptOf(user.id, survey.id);
    if (active) {
      return fail(409, "CONFLICTING_ACTIVE_ATTEMPT", "You already have an active attempt for this survey.", {
        details: {
          attemptId: active.attemptId,
          responseId: active.responseId,
          formVersionId: active.formVersionId,
          type: active.type,
          expiresAt: active.expiresAt,
        },
      });
    }
    // Decision E5-D1: 6 wrong codes on this FormVersion refuse new attempts too.
    const wrongCodes = accountWrongCodeCount(user.id, survey.formVersionId);
    if (survey.type === "EXTERNAL" && isCompletionCodeLimitReached(wrongCodes)) {
      return fail(409, COMPLETION_CODE_LIMIT_REACHED_CODE, "You have used every completion-code try for this survey version.", {
        details: {
          formVersionId: survey.formVersionId,
          failedVerifications: wrongCodes,
          limit: COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion,
          policyVersion: COMPLETION_CODE_POLICY_VERSION,
        },
      });
    }
    // Completions plus unexpired reservations of other respondents hold the quota.
    if (survey.completedCompletions + activeReservationCount(survey.id) >= survey.expectedCompletions) {
      return fail(409, "SURVEY_QUOTA_FULL", "This survey has reached its maximum response quota or active reservation capacity.");
    }

    const attempt = createAttempt({
      userId: user.id,
      surveyId: survey.id,
      formVersionId: survey.formVersionId,
      versionNumber: survey.versionNumber,
      type: survey.type,
    });
    return ok(toAttemptDto(attempt, survey.externalUrl), 201);
  }),

  // ASSUMED API CONTRACT: GET /attempts/:attemptId (see lib/participation/attempts-service.ts).
  http.get(apiUrl("/attempts/:attemptId"), async ({ params }) => {
    const forced = await applyScenario("participation");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const attempt = findAttempt(String(params.attemptId));
    if (!attempt || attempt.userId !== user.id) return fail(404, "ATTEMPT_NOT_FOUND", "Attempt not found.");
    const survey = findSurvey(attempt.surveyId);
    if (!survey) return fail(404, "ATTEMPT_NOT_FOUND", "Attempt not found.");
    // The backend abandons an expired reservation lazily; the ASSUMED read route reports it.
    const expired = attempt.status === "IN_PROGRESS" && Date.parse(attempt.expiresAt) <= Date.now();
    if (attempt.status === "COMPLETED") releaseDuePendingRewards(user);
    const reward = attempt.status === "COMPLETED" ? rewardOutcomeOf(user, attempt.attemptId) : null;
    return ok({
      attemptId: attempt.attemptId,
      responseId: attempt.responseId,
      formId: attempt.surveyId,
      formVersionId: attempt.formVersionId,
      versionNumber: attempt.versionNumber ?? survey.versionNumber,
      type: attempt.type,
      status: expired ? "ABANDONED" : attempt.status,
      closedReason: expired ? "EXPIRED" : attempt.closedReason,
      rewardStatus: reward?.status ?? null,
      startedAt: attempt.startedAt,
      expiresAt: attempt.expiresAt,
      submittedAt: attempt.submittedAt,
      wrongCodeCount: attempt.wrongCodeCount,
      accountWrongCodeCount: accountWrongCodeCount(attempt.userId, attempt.formVersionId),
      timeBarrier: mockTimeBarrierOf(attempt),
      survey: {
        title: survey.title,
        rewardPerResponse: survey.rewardPerResponse,
        estimatedEffortSeconds: survey.estimatedEffortSeconds,
        publisherName: survey.publisherName,
        externalUrl: survey.externalUrl,
      },
    });
  }),
];
