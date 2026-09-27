import { HttpResponse, http, type RequestHandler } from "msw";
import {
  TIME_BARRIER_POLICY_VERSION,
  TIME_BARRIER_SECONDS_PER_QUESTION,
  computeInternalTimeBarrier,
  internalFormSubmissionInputSchema,
  submitSurveyFeedbackInputSchema,
  validateAnswersAgainstFormDefinition,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { attempts, findAttempt, updateAttempt, type MockAttempt } from "../data/attempts";
import { creditSurveyReward, holdSurveyReward, releaseDuePendingRewards, rewardOutcomeOf } from "../data/economy";
import { acceptConsent, consentOf, reliabilityOf, saveFeedback, surveyFeedback } from "../data/integrity";
import { updateNotifications } from "../data/notifications";
import { publicFormOf, surveyContentOf } from "../data/survey-content";
import { findSurvey, markSurveyCompleted, updateSurvey } from "../data/surveys";
import { getMockSessionUser } from "../db/session";
import { mockId, nowIso } from "../db/store";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario, getActiveScenario } from "../scenarios";

/**
 * Phase 3B — taking a survey inside Rescom (Figma 4, 6, 14, 17c, 17d).
 * VERIFIED routes mirror `participation.controller.ts`,
 * `survey-feedback.controller.ts` and `public-forms.controller.ts`; ASSUMED
 * ones are documented in `lib/participation/*-service.ts`.
 * Scenarios: `?msw=submit-offline` (submit → network error, 4b),
 * `?msw=integrity-hold` (reward held for quality review, 17c).
 */

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validationFailed(message: string, details: unknown) {
  return fail(400, "VALIDATION_ERROR", message, { details });
}

const isFinished = (attempt: MockAttempt) => attempt.status === "COMPLETED";

function pushNotification(userId: string, type: "REWARD_EARNED" | "REWARD_PENDING" | "ACCOUNT_ACTIVATED", message: string) {
  updateNotifications(userId, (items) => {
    items.unshift({ id: mockId(), type, message, isRead: false, createdAt: nowIso(), readAt: null });
  });
}

export const internalParticipationHandlers: RequestHandler[] = [
  // ASSUMED API CONTRACT: GET /surveys/:id — the one public survey summary
  // (consent card + 18.7 "Khảo sát đã đủ người"). No session needed.
  http.get(apiUrl("/surveys/:id"), async ({ params }) => {
    const forced = await applyScenario("public-surveys");
    if (forced) return forced;
    const survey = findSurvey(String(params.id));
    if (!survey) return fail(404, "SURVEY_NOT_FOUND", "Survey not found.");
    return ok({
      id: survey.id,
      title: survey.title,
      type: survey.type,
      status: survey.status,
      rewardPerResponse: survey.rewardPerResponse,
      estimatedEffortSeconds: survey.estimatedEffortSeconds,
      expectedCompletions: survey.expectedCompletions,
      completedCompletions: survey.completedCompletions,
      publisherName: survey.publisherName,
    });
  }),

  // VERIFIED: GET /public/forms/:id → publicFormDetailsSchema (+ ASSUMED `sections`).
  http.get(apiUrl("/public/forms/:id"), async ({ params }) => {
    const forced = await applyScenario("participation");
    if (forced) return forced;
    const survey = findSurvey(String(params.id));
    const content = survey && survey.type === "INTERNAL" ? surveyContentOf(survey.id) : undefined;
    if (!survey || !content) return fail(404, "FORM_NOT_FOUND", "Form not found.");
    return ok(publicFormOf(survey, content));
  }),

  // ASSUMED API CONTRACT: GET|POST /integrity/consent (consent-service.ts).
  http.get(apiUrl("/integrity/consent"), async () => {
    const forced = await applyScenario("integrity");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    return ok(consentOf(user.id));
  }),

  http.post(apiUrl("/integrity/consent"), async ({ request }) => {
    const forced = await applyScenario("integrity");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const body = (await readJson(request)) as { noticeVersion?: unknown } | null;
    const version = body?.noticeVersion;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      return validationFailed("noticeVersion must be a positive integer", { noticeVersion: version });
    }
    return ok(acceptConsent(user.id, version));
  }),

  // VERIFIED: POST /responses/:responseId/integrity-events (public, no CSRF). Accepted and dropped.
  http.post(apiUrl("/responses/:responseId/integrity-events"), async ({ request }) => {
    const body = (await readJson(request)) as { events?: unknown[] } | null;
    const count = Array.isArray(body?.events) ? body.events.length : 0;
    return ok({ accepted: count, duplicates: 0 });
  }),

  // VERIFIED: POST /responses/:responseId/submit → internalFormSubmissionResponseSchema.
  http.post(apiUrl("/responses/:responseId/submit"), async ({ request, params }) => {
    const forced = await applyScenario("participation");
    if (forced) return forced;
    if (getActiveScenario() === "submit-offline") return HttpResponse.error();
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;

    const body = internalFormSubmissionInputSchema.safeParse(await readJson(request));
    if (!body.success) return validationFailed(body.error.errors[0]?.message ?? "Validation failed", body.error.format());

    const responseId = String(params.responseId);
    const attempt = attempts.get().find((item) => item.responseId === responseId && item.userId === user.id);
    if (!attempt || (body.data.attemptId && body.data.attemptId !== attempt.attemptId)) {
      return fail(404, "RESPONSE_NOT_FOUND", "Response not found.");
    }
    // Decision E5-D3: a resubmission replays the original result (200).
    if (isFinished(attempt) && attempt.submission) return ok(attempt.submission);
    if (isFinished(attempt)) {
      return fail(409, "SURVEY_ALREADY_COMPLETED", "You have already completed this survey.");
    }
    if (attempt.status !== "IN_PROGRESS" || Date.parse(attempt.expiresAt) <= Date.now()) {
      return fail(409, "ATTEMPT_EXPIRED", "Survey attempt has expired or was abandoned. Please start a new attempt.");
    }
    const survey = findSurvey(attempt.surveyId);
    const content = survey ? surveyContentOf(survey.id) : undefined;
    if (!survey || !content) return fail(404, "SURVEY_NOT_AVAILABLE", "Survey is not available for participation.");

    const validation = validateAnswersAgainstFormDefinition(content.blocks, body.data.answers);
    if (!validation.isValid) {
      return fail(400, "INVALID_FORM_SUBMISSION", "Form submission contains invalid or missing answers.", {
        details: validation.errors,
      });
    }

    const barrier = computeInternalTimeBarrier({ blocks: content.blocks, metadata: content.metadata });
    const elapsedSeconds = Math.floor((Date.now() - Date.parse(attempt.startedAt)) / 1000);
    if (elapsedSeconds < barrier.requiredSeconds) {
      const remainingSeconds = barrier.requiredSeconds - elapsedSeconds;
      return fail(422, "SUBMISSION_TOO_FAST", "Submission was completed faster than the required minimum time barrier.", {
        details: {
          requiredSeconds: barrier.requiredSeconds,
          elapsedSeconds,
          remainingSeconds,
          retryAfterSeconds: remainingSeconds,
          earliestSubmitAt: new Date(Date.parse(attempt.startedAt) + barrier.requiredSeconds * 1000).toISOString(),
          questionCount: barrier.questionCount,
          secondsPerQuestion: TIME_BARRIER_SECONDS_PER_QUESTION,
          publisherMinimumSeconds: barrier.publisherMinimumSeconds,
          policyVersion: TIME_BARRIER_POLICY_VERSION,
        },
        headers: { "Retry-After": String(remainingSeconds) },
      });
    }

    const submittedAt = nowIso();
    updateAttempt(attempt.attemptId, (target) => {
      target.status = "COMPLETED";
      target.submittedAt = submittedAt;
      target.answers = validation.normalizedAnswers;
    });
    markSurveyCompleted(user.id, user.email, survey.id);
    updateSurvey(survey.id, (target) => {
      target.completedCompletions = Math.min(target.expectedCompletions, target.completedCompletions + 1);
    });

    const reward = { amount: survey.rewardPerResponse, surveyId: survey.id, attemptId: attempt.attemptId, title: survey.title };
    const held = getActiveScenario() === "integrity-hold";
    if (held) {
      holdSurveyReward(user, reward);
      pushNotification(
        user.id,
        "REWARD_PENDING",
        `+${reward.amount} điểm đang giữ để xét — Từ “${survey.title}”. Rescom đang xét chất lượng câu trả lời.`,
      );
    } else {
      const { activated } = creditSurveyReward(user, { ...reward, pending: false });
      pushNotification(user.id, "REWARD_EARNED", `+${reward.amount} điểm vào Khả dụng — Từ “${survey.title}”.`);
      if (activated) {
        pushNotification(
          user.id,
          "ACCOUNT_ACTIVATED",
          "Tài khoản đã kích hoạt — 100 điểm khởi đầu đã mở khoá. Bạn có thể dùng để đăng khảo sát.",
        );
      }
    }

    const result = {
      responseId,
      attemptId: attempt.attemptId,
      formId: survey.id,
      formVersionId: attempt.formVersionId,
      status: "VALIDATED" as const,
      submittedAt,
      reward: {
        status: held ? ("HELD_IN_INTEGRITY" as const) : ("SETTLED" as const),
        journalId: mockId(),
        amount: reward.amount,
        targetAccountClass: held ? ("INTEGRITY_HOLD" as const) : ("USER_AVAILABLE" as const),
        settledAt: submittedAt,
      },
      policyMode: held ? ("ENFORCED" as const) : ("SHADOW" as const),
    };
    updateAttempt(attempt.attemptId, (target) => {
      target.submission = result;
    });
    return ok(result);
  }),

  // ASSUMED API CONTRACT: GET /attempts/:attemptId/outcome (submission-service.ts).
  http.get(apiUrl("/attempts/:attemptId/outcome"), async ({ params }) => {
    const forced = await applyScenario("participation");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const attempt = findAttempt(String(params.attemptId));
    if (!attempt || attempt.userId !== user.id) return fail(404, "ATTEMPT_NOT_FOUND", "Attempt not found.");
    releaseDuePendingRewards(user);
    const outcome = rewardOutcomeOf(user, attempt.attemptId);
    return ok({
      attemptId: attempt.attemptId,
      reward: outcome
        ? { status: outcome.status, amount: outcome.amount, targetAccountClass: outcome.targetAccountClass }
        : null,
      accountActivated: outcome?.accountActivated ?? false,
      submittedAt: attempt.submittedAt,
    });
  }),

  // VERIFIED: GET /attempts/:attemptId/feedback → surveyFeedbackStatusSchema.
  http.get(apiUrl("/attempts/:attemptId/feedback"), async ({ params }) => {
    const forced = await applyScenario("feedback");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const attempt = findAttempt(String(params.attemptId));
    if (!attempt || attempt.userId !== user.id) {
      return fail(404, "FEEDBACK_ATTEMPT_NOT_FOUND", "Survey attempt not found.");
    }
    const feedback = surveyFeedback.get()[attempt.attemptId] ?? null;
    const state = feedback ? "SUBMITTED" : isFinished(attempt) ? "ELIGIBLE" : "NOT_ELIGIBLE";
    return ok({ attemptId: attempt.attemptId, state, feedback });
  }),

  // VERIFIED: POST /attempts/:attemptId/feedback → submitSurveyFeedbackResultSchema.
  http.post(apiUrl("/attempts/:attemptId/feedback"), async ({ request, params }) => {
    const forced = await applyScenario("feedback");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const attempt: MockAttempt | undefined = findAttempt(String(params.attemptId));
    if (!attempt || attempt.userId !== user.id) {
      return fail(404, "FEEDBACK_ATTEMPT_NOT_FOUND", "Survey attempt not found.");
    }
    if (!isFinished(attempt)) {
      return fail(409, "FEEDBACK_NOT_ALLOWED", "Feedback is only allowed after completing the survey.");
    }
    const body = submitSurveyFeedbackInputSchema.safeParse(await readJson(request));
    if (!body.success) return validationFailed(body.error.errors[0]?.message ?? "Validation failed", body.error.format());

    const existing = surveyFeedback.get()[attempt.attemptId];
    if (existing) {
      const same =
        existing.rating === body.data.rating &&
        existing.comment === body.data.comment &&
        existing.issueTags.join() === body.data.issueTags.join();
      return same
        ? ok({ feedback: existing, replayed: true })
        : fail(409, "FEEDBACK_ALREADY_SUBMITTED", "Feedback for this survey attempt has already been submitted.");
    }
    return ok({ feedback: saveFeedback(attempt, body.data), replayed: false });
  }),

  // ASSUMED API CONTRACT: GET /integrity/reliability/me (trust-service.ts).
  http.get(apiUrl("/integrity/reliability/me"), async () => {
    const forced = await applyScenario("integrity");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    return ok(reliabilityOf(user));
  }),
];
