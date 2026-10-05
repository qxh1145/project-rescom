import type { DemographicOnboardingNextStep, SubmitDemographicSurveyInput } from "@rescom/schemas";
import {
  stepFromValidationDetails,
  toProfilePatch,
  toSurveyPayload,
  type OnboardingAnswers,
  type ProfilePatch,
} from "./onboarding-answers.ts";
import { isValidationError } from "./onboarding-messages.ts";
import type { QuestionStep } from "./onboarding-steps.ts";

export interface OnboardingSubmitDeps {
  /** VERIFIED `POST /demographics/survey`. */
  submitSurvey: (input: SubmitDemographicSurveyInput) => Promise<{ nextStep: DemographicOnboardingNextStep }>;
  /** VERIFIED `PATCH /users/me/profile`. */
  updateProfile: (input: ProfilePatch) => Promise<unknown>;
}

export interface OnboardingSubmitResult {
  nextStep: DemographicOnboardingNextStep;
  /** The extras (name, birth year, school, goal) could not be saved; the survey was. */
  profileError: unknown | null;
}

/**
 * The required survey goes first and its failure fails the submit: it alone
 * opens the onboarding gate. The profile extras follow; their failure never
 * blocks finishing onboarding but is returned, so the done screen can say so
 * and offer a retry (`saveProfileExtras`).
 */
export async function submitOnboarding(
  answers: OnboardingAnswers,
  currentYear: number,
  deps: OnboardingSubmitDeps,
): Promise<OnboardingSubmitResult> {
  const { nextStep } = await deps.submitSurvey(toSurveyPayload(answers, currentYear));
  return { nextStep, profileError: await saveProfileExtras(answers, currentYear, deps.updateProfile) };
}

/** Saves the profile extras of `answers`: the error, or null once saved. Also the done-screen retry. */
export async function saveProfileExtras(
  answers: OnboardingAnswers,
  currentYear: number,
  updateProfile: OnboardingSubmitDeps["updateProfile"],
): Promise<unknown | null> {
  try {
    await updateProfile(toProfilePatch(answers, currentYear));
    return null;
  } catch (error) {
    return error;
  }
}

/** A failed profile save the user must hear about: any error except an aborted request. */
export function isProfileSaveFailure(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  return !(typeof error === "object" && (error as { name?: unknown }).name === "AbortError");
}

/**
 * The question to fix after a profile save refused with 400 VALIDATION_ERROR
 * (the done screen's "Sửa"): the first field named in `details`, else the
 * first profile question. null for any other failure ("Thử lại" may work).
 */
export function profileFixStep(error: unknown): QuestionStep | null {
  if (!isValidationError(error)) return null;
  return stepFromValidationDetails(error.details) ?? "name";
}
