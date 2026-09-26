import {
  ActivationSurveyDto,
  ActivationSurveySource,
  EXTERNAL_COMPLETION_REVIEW_HOURS,
  STARTER_ACTIVATION_MIN_SURVEY_REWARD,
  STARTER_ACTIVATION_MISSING_STEPS,
  STARTER_POINTS_EXPIRY_DAYS,
  StarterActivationState,
} from "./starter-points.schema";

/**
 * Starter-points activation rule (Story 7.2, FR-5/FR-7/FR-8).
 *
 * One pure definition shared by the backend `StarterPointsCoordinator` and the
 * frontend mock repository, so both decide activation the same way:
 *
 * - Activation needs a complete demographic profile (FR-6) plus ONE eligible
 *   Marketplace survey completion (FR-7). Callers pass only eligible
 *   completions: authenticated completions of surveys published by someone
 *   else (never the respondent's own survey, never the demographic survey).
 * - Only surveys paying at least `STARTER_ACTIVATION_MIN_SURVEY_REWARD` (1)
 *   point per response count (decision E7-DN2, option B(1)); callers filter
 *   in their queries too, and the rule re-checks `rewardPerResponse`.
 * - An Internal completion counts immediately (server-validated answers).
 * - An External completion counts only after its 48-hour review window
 *   (FR-24) — a completion code is an unverified claim the Publisher may still
 *   dispute, and FR-48 requires that mass-created accounts yield no usable
 *   Points.
 * - Only completions made within 30 days of registration count (FR-5). The
 *   unlock itself may happen later (catch-up after a failed unlock or while an
 *   in-window External review is still running), but only while the
 *   demographic profile is complete (7.2 AC4); anything else past the
 *   deadline is expired. Past the deadline the only states are ACTIVATED,
 *   READY_TO_UNLOCK, PENDING_CONFIRMATION, EXPIRED (or NOT_GRANTED when there
 *   is nothing to activate). Finality of EXPIRED is anchored on the
 *   `starter-expiry` journal (the backend sweep / the mock's lazy void).
 * - "Verified Member" (FR-7, decision E7-DN3) is separate from the points:
 *   both onboarding steps done (complete profile + a confirmed eligible
 *   completion made at ANY time, even past the deadline or after expiry), or
 *   the starter points were unlocked. Expiry forfeits only the points (FR-5).
 */

/** Decision E7-DN2 (B(1)): the survey must pay at least 1 point per response. */
export function isStarterActivationRewardEligible(
  rewardPerResponse: number,
): boolean {
  return (
    Number.isFinite(rewardPerResponse) &&
    rewardPerResponse >= STARTER_ACTIVATION_MIN_SURVEY_REWARD
  );
}

/** One eligible Marketplace survey completion (already filtered by the caller). */
export interface StarterActivationCompletion {
  source: ActivationSurveySource;
  formId: string;
  completedAt: Date | string;
  /** The survey's reward per response; below 1 point it never qualifies (E7-DN2). */
  rewardPerResponse: number;
  /**
   * External only: when the review window is known to have closed before
   * `completedAt + 48 h`. Only the frontend mock's demo control (decision
   * E7-DN1, "Mô phỏng hết 48 giờ đối soát") sets it, so the demo never has to
   * rewrite `completedAt` (which drives the 30-day window and rate limits);
   * the backend leaves it unset. Never earlier than `completedAt`.
   */
  reviewClosedAt?: Date | string | null;
}

export interface EvaluateStarterActivationInput {
  now: Date;
  registeredAt: Date;
  /** A `starter-grant` journal exists or Frozen points are held. */
  isGranted: boolean;
  frozenBalance: number;
  isDemographicComplete: boolean;
  completions: readonly StarterActivationCompletion[];
  /** Creation time of the `starter-unlock:{userId}` journal, if any. */
  unlockedAt?: Date | null;
  /** Creation time of the `starter-expiry:{userId}` journal, if any. */
  expiredAt?: Date | null;
}

export interface StarterActivationEvaluation {
  state: StarterActivationState;
  expiresAt: Date;
  daysRemaining: number;
  isDeadlinePassed: boolean;
  isUnlocked: boolean;
  isExpired: boolean;
  /** A confirmed, in-window eligible completion exists. */
  hasQualifyingSurvey: boolean;
  /** The unlock may be posted now. */
  eligible: boolean;
  missingSteps: string[];
  qualifyingSurvey: ActivationSurveyDto | null;
  pendingSurvey: ActivationSurveyDto | null;
  activationSurvey: ActivationSurveyDto | null;
  /**
   * FR-7 "Verified Member" (decision E7-DN3): unlocked, or a complete profile
   * plus a confirmed eligible completion made at any time. Not tied to the
   * 30-day window or to expiry.
   */
  isVerifiedMember: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function getStarterPointsExpiresAt(registeredAt: Date): Date {
  return new Date(registeredAt.getTime() + STARTER_POINTS_EXPIRY_DAYS * DAY_MS);
}

function toActivationSurvey(
  completion: StarterActivationCompletion,
  now: Date,
): ActivationSurveyDto | null {
  const completedAt = new Date(completion.completedAt);
  if (Number.isNaN(completedAt.getTime())) return null;
  let confirmsAt = completedAt;
  if (completion.source === "EXTERNAL") {
    const windowEnd = completedAt.getTime() + EXTERNAL_COMPLETION_REVIEW_HOURS * HOUR_MS;
    const closedAt = completion.reviewClosedAt
      ? new Date(completion.reviewClosedAt).getTime()
      : Number.NaN;
    confirmsAt = new Date(
      Number.isNaN(closedAt)
        ? windowEnd
        : Math.min(windowEnd, Math.max(closedAt, completedAt.getTime())),
    );
  }
  return {
    source: completion.source,
    formId: completion.formId,
    completedAt: completedAt.toISOString(),
    confirmsAt: confirmsAt.toISOString(),
    status: confirmsAt.getTime() <= now.getTime() ? "CONFIRMED" : "PENDING_REVIEW",
  };
}

export function evaluateStarterActivation(
  input: EvaluateStarterActivationInput,
): StarterActivationEvaluation {
  const { now } = input;
  const expiresAt = getStarterPointsExpiresAt(input.registeredAt);
  const isDeadlinePassed = now.getTime() > expiresAt.getTime();
  const daysRemaining = Math.max(
    0,
    Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS),
  );

  const eligibleSurveys = input.completions
    .filter((completion) =>
      isStarterActivationRewardEligible(completion.rewardPerResponse),
    )
    .map((completion) => toActivationSurvey(completion, now))
    .filter((survey): survey is ActivationSurveyDto => survey !== null);
  const hasConfirmedCompletionAnyTime = eligibleSurveys.some(
    (survey) => survey.status === "CONFIRMED",
  );

  const inWindow = eligibleSurveys
    .filter(
      (survey) => new Date(survey.completedAt).getTime() <= expiresAt.getTime(),
    )
    .sort(
      (a, b) =>
        new Date(a.confirmsAt).getTime() - new Date(b.confirmsAt).getTime() ||
        new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
    );

  const qualifyingSurvey = inWindow.find((s) => s.status === "CONFIRMED") ?? null;
  const pendingSurvey = inWindow.find((s) => s.status === "PENDING_REVIEW") ?? null;

  const isUnlocked = Boolean(input.unlockedAt);
  const hasStarterPoints = input.isGranted && input.frozenBalance > 0;
  // The profile must be complete at evaluation time, before and after the
  // deadline (7.2 AC4: "only after a qualifying completion (and a complete
  // demographic profile)"). Past the deadline an in-window completion catches
  // up only while the profile is complete; otherwise the evaluation is
  // EXPIRED (Epic 7 review P2 — a completion never stands in for the profile,
  // which may have been cleared later via PUT /demographics).
  const demographicsDone = input.isDemographicComplete;
  const canUnlockNow =
    !isUnlocked &&
    !input.expiredAt &&
    hasStarterPoints &&
    demographicsDone &&
    qualifyingSurvey !== null;
  const awaitingReview =
    pendingSurvey !== null && hasStarterPoints && demographicsDone;

  const isExpired =
    !isUnlocked &&
    (Boolean(input.expiredAt) ||
      (input.isGranted && isDeadlinePassed && !canUnlockNow && !awaitingReview));

  const eligible = canUnlockNow && !isExpired;

  let state: StarterActivationState;
  if (isUnlocked) state = "ACTIVATED";
  else if (isExpired) state = "EXPIRED";
  else if (!hasStarterPoints) state = "NOT_GRANTED";
  else if (!demographicsDone) state = "DEMOGRAPHICS_REQUIRED";
  else if (eligible) state = "READY_TO_UNLOCK";
  else if (pendingSurvey) state = "PENDING_CONFIRMATION";
  else state = "SURVEY_REQUIRED";

  const missingSteps: string[] = [];
  if (!isUnlocked) {
    if (!demographicsDone) {
      missingSteps.push(STARTER_ACTIVATION_MISSING_STEPS.DEMOGRAPHICS);
    }
    if (!qualifyingSurvey) {
      missingSteps.push(STARTER_ACTIVATION_MISSING_STEPS.MARKETPLACE_SURVEY);
    }
  }

  return {
    state,
    expiresAt,
    daysRemaining,
    isDeadlinePassed,
    isUnlocked,
    isExpired,
    hasQualifyingSurvey: qualifyingSurvey !== null,
    eligible,
    missingSteps,
    qualifyingSurvey,
    pendingSurvey,
    activationSurvey: isUnlocked
      ? qualifyingSurvey
      : (qualifyingSurvey ?? pendingSurvey),
    isVerifiedMember:
      isUnlocked || (demographicsDone && hasConfirmedCompletionAnyTime),
  };
}
