import { SELF_PARTICIPATION_FORBIDDEN_CODE, type SurveyAttemptResponseDto } from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";
import { buildOnboardingRedirect, isDemographicProfileRequiredError } from "../onboarding.ts";
import { conflictingAttemptOf, startSurveyAttempt } from "./attempts-service.ts";
import { START_FLOW_MESSAGES } from "./start-flow-messages.ts";

/**
 * "Start or resume" routing shared by the Khám phá card (3A) and the in-Rescom
 * consent screen (3B). Pure decisions + one async helper with an injectable
 * `start`, so the rules are unit-tested without a network.
 *
 * - INTERNAL card → consent screen `/surveys/:id/start` (the attempt is
 *   created there, after consent).
 * - EXTERNAL card → `POST /surveys/:id/attempts` → `/attempts/:attemptId/google-form`.
 * - 409 CONFLICTING_ACTIVE_ATTEMPT → resume the caller's own attempt.
 * - 409 SURVEY_QUOTA_FULL → `/surveys/:id/full` (18.7).
 * - SURVEY_ALREADY_COMPLETED, SURVEY_NOT_AVAILABLE, not eligible, own survey, 429,
 *   network → inline message.
 * - 403 DEMOGRAPHIC_PROFILE_REQUIRED → onboarding, then back to `returnTo`.
 */

export type SurveyKind = "INTERNAL" | "EXTERNAL";

export type StartDecision =
  | { kind: "navigate"; href: string }
  | { kind: "message"; tone: "info" | "danger"; message: string };

export function consentPath(surveyId: string): string {
  return `/surveys/${encodeURIComponent(surveyId)}/start`;
}

export function surveyFullPath(surveyId: string): string {
  return `/surveys/${encodeURIComponent(surveyId)}/full`;
}

/** Where an attempt is taken: Google Forms flow (3C) or the in-Rescom flow (3B). */
export function attemptPath(attempt: { attemptId: string; type: SurveyKind }): string {
  const id = encodeURIComponent(attempt.attemptId);
  return attempt.type === "EXTERNAL" ? `/attempts/${id}/google-form` : `/attempts/${id}`;
}

/** Maps a failed `POST /surveys/:id/attempts` to the next step. */
export function decisionForStartError(surveyId: string, error: unknown, returnTo = "/marketplace"): StartDecision {
  const conflicting = conflictingAttemptOf(error);
  if (conflicting) return { kind: "navigate", href: attemptPath(conflicting) };
  if (isDemographicProfileRequiredError(error)) {
    return { kind: "navigate", href: buildOnboardingRedirect(returnTo) };
  }
  if (!isApiError(error)) return { kind: "message", tone: "danger", message: START_FLOW_MESSAGES.generic };
  if (error.kind === "network") return { kind: "message", tone: "danger", message: START_FLOW_MESSAGES.network };
  switch (error.code) {
    case "SURVEY_QUOTA_FULL":
      return { kind: "navigate", href: surveyFullPath(surveyId) };
    case "SURVEY_ALREADY_COMPLETED":
      return { kind: "message", tone: "info", message: START_FLOW_MESSAGES.alreadyCompleted };
    case "SURVEY_NOT_AVAILABLE":
      return { kind: "message", tone: "info", message: START_FLOW_MESSAGES.notAvailable };
    case "PARTICIPANT_NOT_ELIGIBLE":
      return { kind: "message", tone: "info", message: START_FLOW_MESSAGES.notEligible };
    // Decision E4-DN2: a publisher cannot take their own survey.
    case SELF_PARTICIPATION_FORBIDDEN_CODE:
      return { kind: "message", tone: "info", message: START_FLOW_MESSAGES.ownSurvey };
    default:
      break;
  }
  if (error.status === 429) return { kind: "message", tone: "danger", message: START_FLOW_MESSAGES.rateLimited };
  return { kind: "message", tone: "danger", message: START_FLOW_MESSAGES.generic };
}

export type StartAttempt = (surveyId: string) => Promise<Pick<SurveyAttemptResponseDto, "attemptId" | "type">>;

/**
 * Creates the attempt (or finds the one to resume) and returns where to go.
 * Used by the EXTERNAL card and by the consent screen after "Đồng ý".
 */
export async function startAttemptDecision(
  surveyId: string,
  options: { start?: StartAttempt; returnTo?: string } = {},
): Promise<StartDecision> {
  const start = options.start ?? ((id: string) => startSurveyAttempt(id));
  try {
    const attempt = await start(surveyId);
    return { kind: "navigate", href: attemptPath(attempt) };
  } catch (error) {
    return decisionForStartError(surveyId, error, options.returnTo);
  }
}

/** Khám phá "Bắt đầu": INTERNAL goes to consent first, EXTERNAL starts right away. */
export function startOrResumeSurvey(
  survey: { id: string; type: SurveyKind },
  options: { start?: StartAttempt; returnTo?: string } = {},
): Promise<StartDecision> {
  if (survey.type === "INTERNAL") return Promise.resolve({ kind: "navigate", href: consentPath(survey.id) });
  return startAttemptDecision(survey.id, options);
}
