import { z } from "zod";
import { COLLECTION_DAY_CHOICES, emptyWizardDraft, type GoogleFormWizardDraft } from "./create-wizard.ts";

/**
 * Browser state of the Google Forms wizard:
 * - the draft (localStorage, one per user) so a reload or a trip to
 *   "Nạp điểm" keeps what was typed;
 * - the one-time completion code returned by `POST /forms/external`
 *   (sessionStorage, per tab) so 9d can show it after the redirect. The
 *   backend never returns the plaintext code again (only a rotation, which is
 *   refused while the survey waits for moderation: 409 `FORM_IN_MODERATION`).
 */

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DRAFT_PREFIX = "rescom:create-gform-draft:";
const SUBMITTED_PREFIX = "rescom:created-form-code:";

const draftSchema = z.object({
  externalUrl: z.string(),
  title: z.string(),
  topic: z.string(),
  description: z.string(),
  durationBand: z.enum(["UNDER_5", "FROM_5_TO_10", "FROM_10_TO_15", "OVER_15"]).nullable(),
  gender: z.enum(["ALL", "MALE", "FEMALE"]),
  ageMin: z.string(),
  ageMax: z.string(),
  fieldsOfStudy: z.array(z.string()),
  school: z.string(),
  location: z.string(),
  sampleSize: z.string(),
  rewardPerResponse: z.string(),
  collectionDays: z
    .number()
    .refine((days) => (COLLECTION_DAY_CHOICES as readonly number[]).includes(days)),
});

function readJson(storage: KeyValueStorage | null | undefined, key: string): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(storage: KeyValueStorage | null | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the state lives for this page only.
  }
}

function remove(storage: KeyValueStorage | null | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore
  }
}

/** The saved draft, or an empty one (missing, unreadable or an older shape). */
export function loadWizardDraft(storage: KeyValueStorage | null | undefined, userId: string): GoogleFormWizardDraft {
  const parsed = draftSchema.safeParse(readJson(storage, DRAFT_PREFIX + userId));
  return parsed.success ? parsed.data : emptyWizardDraft();
}

export function saveWizardDraft(
  storage: KeyValueStorage | null | undefined,
  userId: string,
  draft: GoogleFormWizardDraft,
): void {
  writeJson(storage, DRAFT_PREFIX + userId, draft);
}

export function clearWizardDraft(storage: KeyValueStorage | null | undefined, userId: string): void {
  remove(storage, DRAFT_PREFIX + userId);
}

const submittedSchema = z.object({
  formId: z.string(),
  userId: z.string(),
  title: z.string(),
  completionCode: z.string().regex(/^\d{6}$/),
  externalUrl: z.string(),
  escrowPoints: z.number().int().nonnegative(),
});

export type SubmittedSurvey = z.infer<typeof submittedSchema>;

export function stashSubmittedSurvey(storage: KeyValueStorage | null | undefined, survey: SubmittedSurvey): void {
  writeJson(storage, SUBMITTED_PREFIX + survey.formId, survey);
}

/** Only the owner who submitted it in this tab sees the code. */
export function readSubmittedSurvey(
  storage: KeyValueStorage | null | undefined,
  formId: string,
  userId: string,
): SubmittedSurvey | null {
  const parsed = submittedSchema.safeParse(readJson(storage, SUBMITTED_PREFIX + formId));
  return parsed.success && parsed.data.userId === userId ? parsed.data : null;
}

export function clearSubmittedSurvey(storage: KeyValueStorage | null | undefined, formId: string): void {
  remove(storage, SUBMITTED_PREFIX + formId);
}

/** `window.localStorage` / `window.sessionStorage`, or null when blocked. */
export function browserStorage(kind: "local" | "session"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}
