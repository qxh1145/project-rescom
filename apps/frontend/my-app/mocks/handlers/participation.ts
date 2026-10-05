import { http } from "msw";
import {
  ATTEMPT_NOT_FOUND_CODE,
  COMPLETION_CODE_LIMIT_REACHED_CODE,
  COMPLETION_CODE_POLICY,
  COMPLETION_CODE_POLICY_VERSION,
  isCompletionCodeLimitReached,
  type SurveyAttemptDetailsDto,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import {
  accountWrongCodeCount,
  activeAttemptOf,
  activeReservationCount,
  createAttempt,
  findAttempt,
  internalTimeBarrierOf,
  mockTimeBarrierOf,
  type MockAttempt,
} from "../data/attempts";
import { pinnedFormOf, surveyContentOf, type MockSurveyContent } from "../data/survey-content";
import { completedSurveyIdsOf, findSurvey, type MockSurvey } from "../data/surveys";
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

/**
 * `surveyAttemptDetailsSchema` (`GET /attempts/:id`). Like the backend the
 * attempt is returned as persisted — an expired reservation stays
 * IN_PROGRESS — and an in-Rescom attempt carries its pinned form.
 */
function toAttemptDetails(
  attempt: MockAttempt,
  survey: MockSurvey,
  content: MockSurveyContent | undefined,
): SurveyAttemptDetailsDto {
  const versionNumber = attempt.versionNumber ?? survey.versionNumber;
  return {
    attemptId: attempt.attemptId,
    responseId: attempt.responseId,
    formId: attempt.surveyId,
    formVersionId: attempt.formVersionId,
    versionNumber,
    type: attempt.type,
    status: attempt.status,
    closedReason: attempt.closedReason,
    closedAt: attempt.closedAt ?? null,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    wrongCodeCount: attempt.wrongCodeCount,
    accountWrongCodeCount:
      attempt.type === "EXTERNAL" ? accountWrongCodeCount(attempt.userId, attempt.formVersionId) : 0,
    timeBarrier: content ? internalTimeBarrierOf(attempt, content) : mockTimeBarrierOf(attempt)!,
    survey: {
      title: survey.title,
      status: survey.status,
      rewardPerResponse: survey.rewardPerResponse,
      estimatedEffortSeconds: survey.estimatedEffortSeconds,
      externalUrl: attempt.type === "EXTERNAL" ? survey.externalUrl : null,
    },
    form: content ? pinnedFormOf(survey, content, { formVersionId: attempt.formVersionId, versionNumber }) : null,
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

  // VERIFIED: GET /attempts/:attemptId (`survey-runner.controller.ts`) → surveyAttemptDetailsSchema.
  http.get(apiUrl("/attempts/:attemptId"), async ({ params }) => {
    const forced = await applyScenario("participation");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const attempt = findAttempt(String(params.attemptId));
    const survey = attempt && attempt.userId === user.id ? findSurvey(attempt.surveyId) : undefined;
    const content = attempt?.type === "INTERNAL" && survey ? surveyContentOf(survey.id) : undefined;
    // Unknown and other users' attempts — and a missing pinned form — are one 404.
    if (!attempt || !survey || (attempt.type === "INTERNAL" && !content?.blocks.length)) {
      return fail(404, ATTEMPT_NOT_FOUND_CODE, "Survey attempt not found.");
    }
    return ok(toAttemptDetails(attempt, survey, content));
  }),
];
