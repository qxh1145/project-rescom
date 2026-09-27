import type { DemographicOnboardingNextStep, SubmitDemographicSurveyInput } from "@rescom/schemas";
import { toProfilePatch, toSurveyPayload, type OnboardingAnswers, type ProfilePatch } from "./onboarding-answers.ts";

export interface OnboardingSubmitDeps {
  /** VERIFIED `POST /demographics/survey`. */
  submitSurvey: (input: SubmitDemographicSurveyInput) => Promise<{ nextStep: DemographicOnboardingNextStep }>;
  /** ASSUMED `PATCH /users/me/profile`. */
  updateProfile: (input: ProfilePatch) => Promise<unknown>;
}

export interface OnboardingSubmitResult {
  nextStep: DemographicOnboardingNextStep;
  /** The extras (name, birth year, school, goal) could not be saved; the survey was. */
  profileError: unknown | null;
}

/**
 * The required, VERIFIED survey goes first and its failure fails the submit.
 * The ASSUMED profile extras follow, best-effort: a missing route (404) or any
 * other error never blocks the respondent from finishing onboarding.
 */
export async function submitOnboarding(
  answers: OnboardingAnswers,
  currentYear: number,
  deps: OnboardingSubmitDeps,
): Promise<OnboardingSubmitResult> {
  const { nextStep } = await deps.submitSurvey(toSurveyPayload(answers, currentYear));
  try {
    await deps.updateProfile(toProfilePatch(answers, currentYear));
    return { nextStep, profileError: null };
  } catch (profileError) {
    return { nextStep, profileError };
  }
}
