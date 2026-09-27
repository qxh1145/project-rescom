import type { DemographicOnboardingNextStep } from "@rescom/schemas";
import { EMPTY_ANSWERS, type OnboardingAnswers } from "./onboarding-answers.ts";

/**
 * Unsent onboarding answers, kept per user in sessionStorage so a reload or
 * the browser back button never loses them (and they end with the tab).
 * After submit it also remembers the backend's `nextStep` for the done screen.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OnboardingDraft {
  /** Complete answers once the user changed anything; null = use the server prefill. */
  answers: OnboardingAnswers | null;
  submitted: { nextStep: DemographicOnboardingNextStep } | null;
  /** ISO time of the last edit: a newer server profile wins over the draft. */
  updatedAt: string | null;
}

export const EMPTY_DRAFT: OnboardingDraft = { answers: null, submitted: null, updatedAt: null };

const KEY_PREFIX = "rescom:onboarding-draft:";

export function draftKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/**
 * The answers to show: the draft, unless the server profile was saved after
 * the draft's last edit (another tab or device) or there is no draft.
 */
export function chooseAnswers(
  draft: OnboardingDraft,
  server: { answers: OnboardingAnswers; updatedAt: string | null } | undefined,
): OnboardingAnswers | null {
  if (!draft.answers) return server?.answers ?? null;
  if (!server?.updatedAt || !draft.updatedAt) return draft.answers;
  return Date.parse(server.updatedAt) > Date.parse(draft.updatedAt) ? server.answers : draft.answers;
}

/**
 * What stays after the done screen: only `nextStep` (a refresh of the done
 * screen reads the answers back from the server).
 */
export function doneOnlyDraft(draft: OnboardingDraft, now: string): OnboardingDraft {
  return { answers: null, submitted: draft.submitted, updatedAt: now };
}

const stringOrNull = (value: unknown) => (typeof value === "string" ? value : null);

/** Tolerates any stored shape: unknown keys are dropped, wrong types fall back to empty. */
function toAnswers(value: unknown): OnboardingAnswers | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const gender = stringOrNull(raw.gender);
  const goal = stringOrNull(raw.goal);
  return {
    ...EMPTY_ANSWERS,
    displayName: typeof raw.displayName === "string" ? raw.displayName : "",
    birthYear: typeof raw.birthYear === "string" ? raw.birthYear : "",
    gender: gender && ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"].includes(gender)
      ? (gender as OnboardingAnswers["gender"])
      : null,
    location: stringOrNull(raw.location),
    occupation: stringOrNull(raw.occupation),
    school: stringOrNull(raw.school),
    schoolYear: stringOrNull(raw.schoolYear),
    fieldOfStudy: stringOrNull(raw.fieldOfStudy),
    householdIncome: stringOrNull(raw.householdIncome),
    interests: Array.isArray(raw.interests) ? raw.interests.filter((item): item is string => typeof item === "string") : [],
    goal: goal && ["EARN", "COLLECT", "BOTH"].includes(goal) ? (goal as OnboardingAnswers["goal"]) : null,
  };
}

export function readDraft(storage: StorageLike | null, userId: string): OnboardingDraft {
  if (!storage) return EMPTY_DRAFT;
  try {
    const raw = storage.getItem(draftKey(userId));
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as {
      answers?: unknown;
      submitted?: { nextStep?: unknown } | null;
      updatedAt?: unknown;
    };
    const nextStep = parsed.submitted?.nextStep;
    return {
      answers: toAnswers(parsed.answers),
      submitted:
        nextStep === "MARKETPLACE_ACTIVATION" || nextStep === "COMPLETED" ? { nextStep } : null,
      updatedAt:
        typeof parsed.updatedAt === "string" && !Number.isNaN(Date.parse(parsed.updatedAt)) ? parsed.updatedAt : null,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function writeDraft(storage: StorageLike | null, userId: string, draft: OnboardingDraft): void {
  try {
    storage?.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the answers then live for this page only.
  }
}

export function clearDraft(storage: StorageLike | null, userId: string): void {
  try {
    storage?.removeItem(draftKey(userId));
  } catch {
    // ignore
  }
}

/** Every user's draft: called on logout so the next person on this tab sees nothing. */
export function clearAllOnboardingDrafts(
  storage: (StorageLike & { readonly length: number; key(index: number): string | null }) | null,
): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // ignore
  }
}

/** `window.sessionStorage`, or null when unavailable (SSR, privacy mode). */
export function browserSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
