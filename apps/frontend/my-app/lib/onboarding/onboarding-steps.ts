import { STUDENT_OCCUPATIONS } from "../demographic-options.ts";

/**
 * Step sequencing of the one-question-per-screen onboarding (Figma page 12,
 * "Onboarding mới"). Pure module shared by the route, its hooks and tests.
 */

export const ONBOARDING_PARTS = ["Về bạn", "Học tập & công việc", "Sở thích", "Mục tiêu"] as const;

/** Figma 12.1 → 12.11, in order. `school`/`school-year` only for students (12.6/12.7). */
export const QUESTION_STEPS = [
  "name",
  "birth-year",
  "gender",
  "location",
  "occupation",
  "school",
  "school-year",
  "field",
  "income",
  "interests",
  "goal",
] as const;

export type QuestionStep = (typeof QUESTION_STEPS)[number];
export type OnboardingStep = "welcome" | QuestionStep | "done";

/** Index into `ONBOARDING_PARTS`. */
const STEP_PART: Record<QuestionStep, number> = {
  name: 0,
  "birth-year": 0,
  gender: 0,
  location: 0,
  occupation: 1,
  school: 1,
  "school-year": 1,
  field: 1,
  income: 1,
  interests: 2,
  goal: 3,
};

const STUDENT_ONLY_STEPS: readonly QuestionStep[] = ["school", "school-year"];

/** Figma 12.5 helper: "sinh viên hay học viên" answer the school questions. */
export function isStudentOccupation(occupation: string | null | undefined): boolean {
  return typeof occupation === "string" && STUDENT_OCCUPATIONS.includes(occupation);
}

/** The questions this user sees, in order. */
export function visibleSteps(answers: { occupation: string | null }): QuestionStep[] {
  const student = isStudentOccupation(answers.occupation);
  return QUESTION_STEPS.filter((step) => student || !STUDENT_ONLY_STEPS.includes(step));
}

export function isQuestionStep(value: unknown): value is QuestionStep {
  return typeof value === "string" && (QUESTION_STEPS as readonly string[]).includes(value);
}

/** `?step=` → step; missing or unknown → the welcome screen. */
export function parseStep(value: string | null | undefined): OnboardingStep {
  if (value === "done" || isQuestionStep(value)) return value;
  return "welcome";
}

export interface StepPosition {
  /** 0-based index into `ONBOARDING_PARTS`. */
  partIndex: number;
  /** 1-based question number inside the part ("câu 2/4"). */
  questionNumber: number;
  questionCount: number;
}

export function stepPosition(step: QuestionStep, answers: { occupation: string | null }): StepPosition {
  const partIndex = STEP_PART[step];
  const inPart = visibleSteps(answers).filter((candidate) => STEP_PART[candidate] === partIndex);
  // A hidden student step asked directly still gets a sensible number.
  const index = inPart.indexOf(step);
  return {
    partIndex,
    questionNumber: index === -1 ? 1 : index + 1,
    questionCount: Math.max(inPart.length, 1),
  };
}

/** The question after `step`, or `"done"` after the last one (= submit). */
export function nextStepOf(step: QuestionStep, answers: { occupation: string | null }): QuestionStep | "done" {
  const steps = visibleSteps(answers);
  const index = steps.indexOf(step);
  if (index === -1) return steps[0];
  return steps[index + 1] ?? "done";
}

/** The screen before `step`: the welcome screen before 12.1. */
export function previousStepOf(step: QuestionStep, answers: { occupation: string | null }): OnboardingStep {
  const steps = visibleSteps(answers);
  const index = steps.indexOf(step);
  if (index <= 0) return index === 0 ? "welcome" : steps[0];
  return steps[index - 1];
}

/**
 * `/onboarding?step=…` keeping the other params (`required`, `returnTo`).
 * The welcome screen has no `step`.
 */
export function buildStepHref(step: OnboardingStep, current: URLSearchParams | string): string {
  const params = new URLSearchParams(current);
  if (step === "welcome") params.delete("step");
  else params.set("step", step);
  const query = params.toString();
  return query ? `/onboarding?${query}` : "/onboarding";
}
