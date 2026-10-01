import {
  DEMOGRAPHIC_INTERESTS_MAX,
  hasProfileControlCharacters,
  schoolYearSchema,
  USER_PROFILE_DISPLAY_NAME_MAX,
  type DemographicProfileDto,
  type DemographicProfileField,
  type Gender,
  type SchoolYear,
  type SubmitDemographicSurveyInput,
  type UpdateUserProfileInput,
  type UserGoal,
  type UserProfileDto,
} from "@rescom/schemas";
import { GENDER_OPTIONS } from "../demographic-options.ts";
import { interestsShortfallMessage, ONBOARDING_MESSAGES } from "./onboarding-messages.ts";
import {
  isStudentOccupation,
  QUESTION_STEPS,
  visibleSteps,
  type OnboardingStep,
  type QuestionStep,
} from "./onboarding-steps.ts";

/**
 * Answers of the onboarding flow and their mapping to the two VERIFIED APIs:
 * `POST /demographics/survey` (FR-6 fields) and `PATCH /users/me/profile`
 * (display name, birth year, school, school year, goal).
 * Pure module: the current year is always passed in.
 */

/** The shared `UserGoal` (`@rescom/schemas`). */
export type OnboardingGoal = UserGoal;

/** Figma 12.11 option titles. */
export const GOAL_LABELS: Record<OnboardingGoal, string> = {
  EARN: "Làm khảo sát, tích điểm",
  COLLECT: "Tìm người trả lời cho nghiên cứu",
  BOTH: "Cả hai",
};

export interface OnboardingAnswers {
  displayName: string;
  /** Raw input (4 digits when valid); the backend stores the derived age. */
  birthYear: string;
  gender: Gender | null;
  location: string | null;
  occupation: string | null;
  /** Students only (12.6). */
  school: string | null;
  /** Students only (12.7), e.g. "Năm 3". */
  schoolYear: string | null;
  fieldOfStudy: string | null;
  householdIncome: string | null;
  interests: string[];
  goal: OnboardingGoal | null;
}

export const EMPTY_ANSWERS: OnboardingAnswers = {
  displayName: "",
  birthYear: "",
  gender: null,
  location: null,
  occupation: null,
  school: null,
  schoolYear: null,
  fieldOfStudy: null,
  householdIncome: null,
  interests: [],
  goal: null,
};

/** Figma 12.10 asks for at least 3 interests; the backend only requires 1 (FR-6). */
export const MIN_INTERESTS = 3;
export const AGE_MIN = 13;
export const AGE_MAX = 100;
export const DISPLAY_NAME_MAX = USER_PROFILE_DISPLAY_NAME_MAX;

/**
 * Age sent to the backend. ASSUMED: `currentYear − birthYear` (the birthday may
 * not have passed yet; the backend only stores an integer age).
 */
export function ageFromBirthYear(birthYear: number, currentYear: number): number {
  return currentYear - birthYear;
}

export type BirthYearCheck = { ok: true; year: number; age: number } | { ok: false; message: string };

/** 12.2: 4 digits, age 13–100 (the backend's `DEMOGRAPHIC_AGE_MIN/MAX`). */
export function checkBirthYear(raw: string, currentYear: number): BirthYearCheck {
  const value = raw.trim();
  if (value === "") return { ok: false, message: ONBOARDING_MESSAGES.birthYearRequired };
  if (!/^\d{4}$/.test(value)) return { ok: false, message: ONBOARDING_MESSAGES.birthYearFormat };
  const year = Number(value);
  if (year > currentYear) return { ok: false, message: ONBOARDING_MESSAGES.birthYearFuture };
  const age = ageFromBirthYear(year, currentYear);
  if (age < AGE_MIN) return { ok: false, message: ONBOARDING_MESSAGES.tooYoung };
  if (age > AGE_MAX) return { ok: false, message: ONBOARDING_MESSAGES.tooOld };
  return { ok: true, year, age };
}

/** Vietnamese message for the current question, or null when it can be left. */
export function validateStep(step: QuestionStep, answers: OnboardingAnswers, currentYear: number): string | null {
  switch (step) {
    case "name": {
      const name = answers.displayName.trim();
      if (!name) return ONBOARDING_MESSAGES.nameRequired;
      // Same rules as `updateUserProfileSchema`, so the profile save cannot fail on them.
      if (hasProfileControlCharacters(name)) return ONBOARDING_MESSAGES.nameInvalid;
      return name.length > DISPLAY_NAME_MAX ? ONBOARDING_MESSAGES.nameTooLong : null;
    }
    case "birth-year": {
      const check = checkBirthYear(answers.birthYear, currentYear);
      return check.ok ? null : check.message;
    }
    case "gender":
      return answers.gender ? null : ONBOARDING_MESSAGES.genderRequired;
    case "location":
      return answers.location?.trim() ? null : ONBOARDING_MESSAGES.locationRequired;
    case "occupation":
      return answers.occupation?.trim() ? null : ONBOARDING_MESSAGES.occupationRequired;
    case "school": {
      const school = answers.school?.trim();
      if (!school) return ONBOARDING_MESSAGES.schoolRequired;
      return hasProfileControlCharacters(school) ? ONBOARDING_MESSAGES.schoolInvalid : null;
    }
    case "school-year":
      // Only a catalog value saves (`SCHOOL_YEAR_VALUES`); a retired one must be picked again.
      return schoolYearSchema.safeParse(answers.schoolYear).success ? null : ONBOARDING_MESSAGES.schoolYearRequired;
    case "field":
      return answers.fieldOfStudy?.trim() ? null : ONBOARDING_MESSAGES.fieldRequired;
    case "income":
      return answers.householdIncome?.trim() ? null : ONBOARDING_MESSAGES.incomeRequired;
    case "interests": {
      const missing = MIN_INTERESTS - answers.interests.length;
      if (missing > 0) return interestsShortfallMessage(missing, MIN_INTERESTS);
      // Backend bound (`submitDemographicSurveySchema`); only reachable with saved extras.
      return answers.interests.length > DEMOGRAPHIC_INTERESTS_MAX ? ONBOARDING_MESSAGES.interestsTooMany : null;
    }
    case "goal":
      return answers.goal ? null : ONBOARDING_MESSAGES.goalRequired;
  }
}

/** First visible question that still needs an answer, or null when all are valid. */
export function firstInvalidStep(answers: OnboardingAnswers, currentYear: number): QuestionStep | null {
  return visibleSteps(answers).find((step) => validateStep(step, answers, currentYear) !== null) ?? null;
}

/**
 * The screen to show for `?step=`: a question is reachable once every
 * earlier visible question is valid (deep links and refreshes cannot skip
 * ahead), a student-only question needs a student occupation, and the done
 * screen needs a successful submit.
 */
export function resolveStep(
  requested: OnboardingStep,
  answers: OnboardingAnswers,
  submitted: boolean,
  currentYear: number,
): OnboardingStep {
  if (requested === "welcome") return "welcome";
  const firstInvalid = firstInvalidStep(answers, currentYear);
  if (requested === "done") return submitted ? "done" : (firstInvalid ?? "goal");
  const steps = visibleSteps(answers);
  const index = steps.indexOf(requested);
  if (index === -1) {
    // A student-only question for a non-student: the next question that applies (12.8 Ngành).
    const order = QUESTION_STEPS.indexOf(requested);
    const following = steps.find((candidate) => QUESTION_STEPS.indexOf(candidate) > order) ?? "goal";
    return resolveStep(following, answers, submitted, currentYear);
  }
  if (firstInvalid !== null && steps.indexOf(firstInvalid) < index) return firstInvalid;
  return requested;
}

/** VERIFIED `POST /demographics/survey` body (`submitDemographicSurveySchema`). Call only when valid. */
export function toSurveyPayload(answers: OnboardingAnswers, currentYear: number): SubmitDemographicSurveyInput {
  const check = checkBirthYear(answers.birthYear, currentYear);
  if (!check.ok || !answers.gender) throw new Error("Onboarding answers are incomplete");
  return {
    age: check.age,
    gender: answers.gender,
    location: (answers.location ?? "").trim(),
    occupation: (answers.occupation ?? "").trim(),
    fieldOfStudy: (answers.fieldOfStudy ?? "").trim(),
    householdIncome: (answers.householdIncome ?? "").trim(),
    specificInterests: [...answers.interests],
  };
}

export interface ProfilePatch {
  displayName: string;
  birthYear: number | null;
  school: string | null;
  schoolYear: SchoolYear | null;
  goal: OnboardingGoal | null;
}

/**
 * VERIFIED `PATCH /users/me/profile` body (`updateUserProfileSchema`); every
 * key is sent, so the stored profile matches the answers. School answers are
 * cleared for non-students. Call only when valid.
 */
export function toProfilePatch(answers: OnboardingAnswers, currentYear: number): ProfilePatch {
  const check = checkBirthYear(answers.birthYear, currentYear);
  const student = isStudentOccupation(answers.occupation);
  const schoolYear = schoolYearSchema.safeParse(answers.schoolYear);
  return {
    displayName: answers.displayName.trim(),
    birthYear: check.ok ? check.year : null,
    school: student ? answers.school?.trim() || null : null,
    schoolYear: student && schoolYear.success ? schoolYear.data : null,
    goal: answers.goal,
  };
}

const text = (value: string | null | undefined) => (typeof value === "string" && value.trim() ? value : null);

/** Prefill from `GET /demographics` and `GET /users/me/profile` (either may be missing). */
export function answersFromServer(
  demographics: Partial<DemographicProfileDto> | null,
  profile: UserProfileDto | null,
  currentYear: number,
): OnboardingAnswers {
  const age = demographics?.age;
  const birthYear = profile?.birthYear ?? (typeof age === "number" ? currentYear - age : null);
  const interests = Array.isArray(demographics?.specificInterests)
    ? demographics.specificInterests.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  return {
    displayName: profile?.displayName?.trim() ?? "",
    birthYear: birthYear === null ? "" : String(birthYear),
    gender: demographics?.gender ?? null,
    location: text(demographics?.location),
    occupation: text(demographics?.occupation),
    school: text(profile?.school),
    schoolYear: text(profile?.schoolYear),
    fieldOfStudy: text(demographics?.fieldOfStudy),
    householdIncome: text(demographics?.householdIncome),
    interests,
    goal: profile?.goal ?? null,
  };
}

/** Backend FR-6 field → the question that collects it (routing a 400 back to its screen). */
export const FIELD_STEP: Record<DemographicProfileField, QuestionStep> = {
  age: "birth-year",
  gender: "gender",
  location: "location",
  occupation: "occupation",
  fieldOfStudy: "field",
  householdIncome: "income",
  specificInterests: "interests",
};

/** `PATCH /users/me/profile` field → the question that collects it (a 400 of the profile save). */
export const PROFILE_FIELD_STEP: Record<keyof UpdateUserProfileInput, QuestionStep> = {
  displayName: "name",
  birthYear: "birth-year",
  school: "school",
  schoolYear: "school-year",
  goal: "goal",
};

/** True when a zod `format()` subtree holds an error at any depth (`specificInterests.2._errors`). */
function hasFormattedErrors(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  return Object.entries(node).some(([key, child]) =>
    key === "_errors" ? Array.isArray(child) && child.length > 0 : hasFormattedErrors(child),
  );
}

/**
 * First question named by a zod `format()` error tree (`details` of a 400 from
 * the survey or the profile save), in flow order.
 */
export function stepFromValidationDetails(details: unknown): QuestionStep | null {
  if (typeof details !== "object" || details === null) return null;
  const tree = details as Record<string, unknown>;
  const fieldSteps: Record<string, QuestionStep> = { ...FIELD_STEP, ...PROFILE_FIELD_STEP };
  const steps = Object.entries(fieldSteps)
    .filter(([field]) => hasFormattedErrors(tree[field]))
    .map(([, step]) => step);
  if (steps.length === 0) return null;
  return steps.reduce((first, step) => (QUESTION_STEPS.indexOf(step) < QUESTION_STEPS.indexOf(first) ? step : first));
}

/** "Marketing & Truyền thông" → "Marketing" (Figma summary line). */
function shortLabel(value: string): string {
  return value.split(" & ")[0];
}

export interface SummaryItem {
  /** Stable React key: the answer it summarizes. */
  field: "age" | "gender" | "location" | "occupation" | "fieldOfStudy" | "interests";
  text: string;
  /** Figma mobile (62:1998) leaves the occupation out of the summary line. */
  desktopOnly?: boolean;
}

/** Done screen summary: "21 tuổi · Nữ · Đà Nẵng · Sinh viên năm 3 · Marketing · 4 chủ đề". */
export function profileSummary(answers: OnboardingAnswers, currentYear: number): SummaryItem[] {
  const items: SummaryItem[] = [];
  const check = checkBirthYear(answers.birthYear, currentYear);
  if (check.ok) items.push({ field: "age", text: `${check.age} tuổi` });
  const gender = GENDER_OPTIONS.find((option) => option.value === answers.gender);
  if (gender) items.push({ field: "gender", text: gender.label });
  if (answers.location) items.push({ field: "location", text: answers.location });
  if (answers.occupation) {
    const student = answers.occupation === "Sinh viên đại học" && answers.schoolYear;
    items.push({
      field: "occupation",
      text: student ? `Sinh viên ${answers.schoolYear?.toLowerCase()}` : answers.occupation,
      desktopOnly: true,
    });
  }
  if (answers.fieldOfStudy) items.push({ field: "fieldOfStudy", text: shortLabel(answers.fieldOfStudy) });
  if (answers.interests.length > 0) items.push({ field: "interests", text: `${answers.interests.length} chủ đề` });
  return items;
}
