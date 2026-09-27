import {
  EXTERNAL_SURVEY_URL_MAX_LENGTH,
  MAX_EXPECTED_COMPLETIONS,
  calculateEscrowCost,
  externalSurveyUrlSchema,
  getRewardPricingRange,
  isGoogleFormsUrl,
  isHttpsUrl,
  type CreateExternalSurveyInput,
  type Gender,
  type RewardPricingRange,
  type SurveyTargetingCriteria,
} from "@rescom/schemas";
import { FIELDS_OF_STUDY, SCHOOL_OPTIONS, VIETNAM_LOCATIONS } from "../demographic-options.ts";
import { CREATE_MESSAGES } from "./create-messages.ts";

/**
 * Pure rules of the Google Forms creation wizard (Figma 9a info · 9b
 * audience · 9c sample & points · 9c' not enough points). Shared by the
 * screens and `tests/forms-create.test.mjs`; no React/Next imports.
 */

export const WIZARD_STEPS = [1, 2, 3] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** `?step=` → 1…3 (anything else is step 1). */
export function parseWizardStep(raw: string | null | undefined): WizardStep {
  const value = Number(raw);
  return value === 2 || value === 3 ? value : 1;
}

// ---------------------------------------------------------------------------
// Step 1 · thông tin
// ---------------------------------------------------------------------------

/** Figma 9a mobile counter "41/80". ASSUMED UI limit (the backend accepts 200). */
export const TITLE_MAX_LENGTH = 80;
/** `createExternalSurveySchema.description` max. */
export const DESCRIPTION_MAX_LENGTH = 2000;

export type UrlCheck = { valid: true; url: string } | { valid: false; error: string };

/** Same rule the backend enforces (`externalSurveyUrlSchema`: HTTPS, ≤ 2000, Google Forms only). */
export function checkGoogleFormsUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, error: CREATE_MESSAGES.urlRequired };
  const parsed = externalSurveyUrlSchema.safeParse(trimmed);
  if (parsed.success) return { valid: true, url: parsed.data };
  if (trimmed.length > EXTERNAL_SURVEY_URL_MAX_LENGTH) return { valid: false, error: CREATE_MESSAGES.urlTooLong };
  if (isParsableUrl(trimmed) && !isHttpsUrl(trimmed)) return { valid: false, error: CREATE_MESSAGES.urlNotHttps };
  if (isParsableUrl(trimmed) && !isGoogleFormsUrl(trimmed)) {
    return { valid: false, error: CREATE_MESSAGES.urlNotGoogleForms };
  }
  return { valid: false, error: CREATE_MESSAGES.urlInvalid };
}

function isParsableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export type DurationBandId = "UNDER_5" | "FROM_5_TO_10" | "FROM_10_TO_15" | "OVER_15";

export interface DurationBand {
  id: DurationBandId;
  /** Button label (Figma 9a). */
  label: string;
  /** "5–10 phút" in hints and summaries. */
  shortLabel: string;
  /**
   * ASSUMED: the whole minutes sent as `estimatedDurationMinutes` (and
   * `expectedEffortSeconds` = minutes × 60) for each button. Each value sits
   * inside its FR-14 band and within the 30-minute reservation window
   * (decision E5-D2); 8 follows the Figma 9c hint "Khảo sát 8 phút".
   */
  minutes: number;
}

export const DURATION_BANDS: readonly DurationBand[] = [
  { id: "UNDER_5", label: "Dưới 5 phút", shortLabel: "dưới 5 phút", minutes: 4 },
  { id: "FROM_5_TO_10", label: "5 – 10 phút", shortLabel: "5–10 phút", minutes: 8 },
  { id: "FROM_10_TO_15", label: "10 – 15 phút", shortLabel: "10–15 phút", minutes: 13 },
  { id: "OVER_15", label: "Trên 15 phút", shortLabel: "trên 15 phút", minutes: 20 },
];

export function durationBandOf(id: DurationBandId | null | undefined): DurationBand | null {
  return DURATION_BANDS.find((band) => band.id === id) ?? null;
}

/** FR-14 reward band of the chosen duration (`getRewardPricingRange`, VERIFIED shared rule). */
export function rewardRangeOf(id: DurationBandId | null | undefined): RewardPricingRange | null {
  const band = durationBandOf(id);
  return band ? getRewardPricingRange(band.minutes) : null;
}

/**
 * "Chủ đề" (Figma 9a select). It remains wizard metadata until the backend
 * adds a persisted topic field; it must not be sent to the strict create API.
 */
export const TOPIC_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "Marketing", label: "Marketing & Truyền thông" },
  { value: "Kinh tế", label: "Kinh tế & Quản trị kinh doanh" },
  { value: "CNTT", label: "Công nghệ thông tin" },
  { value: "Kỹ thuật", label: "Kỹ thuật & Kiến trúc" },
  { value: "Xã hội", label: "Ngôn ngữ & Khoa học xã hội" },
  { value: "Thiết kế", label: "Thiết kế đồ họa & Mỹ thuật" },
  { value: "Sức khỏe", label: "Y sinh & Sức khỏe" },
  { value: "Đời sống", label: "Đời sống sinh viên" },
  { value: "Khác", label: "Khác" },
];

// ---------------------------------------------------------------------------
// Draft (what the wizard edits and keeps in localStorage)
// ---------------------------------------------------------------------------

export type GenderChoice = "ALL" | Extract<Gender, "MALE" | "FEMALE">;

export interface GoogleFormWizardDraft {
  externalUrl: string;
  title: string;
  /** `TOPIC_OPTIONS` value; "" = none chosen. */
  topic: string;
  description: string;
  durationBand: DurationBandId | null;
  gender: GenderChoice;
  /** Raw inputs ("" = not set). */
  ageMin: string;
  ageMax: string;
  fieldsOfStudy: string[];
  /** "" = every school. */
  school: string;
  /** "" = every region. */
  location: string;
  /** Raw inputs. */
  sampleSize: string;
  /** Raw input; set to the band's suggested reward when a duration is chosen. */
  rewardPerResponse: string;
  collectionDays: number;
}

/** Figma 9c default: 10 respondents. */
export const DEFAULT_SAMPLE_SIZE = 10;

export function emptyWizardDraft(): GoogleFormWizardDraft {
  return {
    externalUrl: "",
    title: "",
    topic: "",
    description: "",
    durationBand: null,
    gender: "ALL",
    ageMin: "",
    ageMax: "",
    fieldsOfStudy: [],
    school: "",
    location: "",
    sampleSize: String(DEFAULT_SAMPLE_SIZE),
    rewardPerResponse: "",
    collectionDays: DEFAULT_COLLECTION_DAYS,
  };
}

export type WizardField =
  | "externalUrl"
  | "title"
  | "description"
  | "durationBand"
  | "age"
  | "criteria"
  | "sampleSize"
  | "rewardPerResponse";

export type WizardErrors = Partial<Record<WizardField, string>>;

export function validateInfoStep(draft: GoogleFormWizardDraft): WizardErrors {
  const errors: WizardErrors = {};
  const url = checkGoogleFormsUrl(draft.externalUrl);
  if (!url.valid) errors.externalUrl = url.error;
  const title = draft.title.trim();
  if (!title) errors.title = CREATE_MESSAGES.titleRequired;
  else if (title.length > TITLE_MAX_LENGTH) errors.title = CREATE_MESSAGES.titleTooLong(TITLE_MAX_LENGTH);
  if (draft.description.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = CREATE_MESSAGES.descriptionTooLong(DESCRIPTION_MAX_LENGTH);
  }
  if (!durationBandOf(draft.durationBand)) errors.durationBand = CREATE_MESSAGES.durationRequired;
  return errors;
}

// ---------------------------------------------------------------------------
// Step 2 · đối tượng (`surveyTargetingSchema`)
// ---------------------------------------------------------------------------

export const GENDER_CHOICES: readonly { value: GenderChoice; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "MALE", label: "Nam" },
  { value: "FEMALE", label: "Nữ" },
];

/** Figma 9b chips (the profile catalog, "Khác" left out). */
export const FIELD_OF_STUDY_CHOICES: readonly string[] = FIELDS_OF_STUDY.filter((field) => field !== "Khác");
/** Figma 9b mobile shows three chips, then "Xem thêm ngành". */
export const FIELDS_SHOWN_COLLAPSED = 3;
export const SCHOOL_CHOICES: readonly string[] = SCHOOL_OPTIONS;
export const LOCATION_CHOICES: readonly string[] = VIETNAM_LOCATIONS;

/**
 * Figma 9b "Trường". Hidden while the backend targeting has no schools
 * (`surveyTargetingSchema` is strict and `toBackendTargetingJson` would drop
 * it, publishing a "school-only" survey to everyone). While false, the school
 * select is not rendered and a `school` in a saved draft is ignored by the
 * targeting, the validation and the summaries. Flip it once the backend
 * matches on schools.
 */
export const SCHOOL_TARGETING_SUPPORTED: boolean = false;

const AGE_MIN = 13;
const AGE_MAX = 100;

type AgeCheck = { ok: true; range: { min: number; max: number } | null } | { ok: false; error: string };

function checkAgeRange(draft: GoogleFormWizardDraft): AgeCheck {
  const min = draft.ageMin.trim();
  const max = draft.ageMax.trim();
  if (!min && !max) return { ok: true, range: null };
  if (!min || !max) return { ok: false, error: CREATE_MESSAGES.ageIncomplete };
  const from = Number(min);
  const to = Number(max);
  const inRange = (value: number) => Number.isInteger(value) && value >= AGE_MIN && value <= AGE_MAX;
  if (!inRange(from) || !inRange(to)) return { ok: false, error: CREATE_MESSAGES.ageOutOfRange };
  if (from > to) return { ok: false, error: CREATE_MESSAGES.ageOrder };
  return { ok: true, range: { min: from, max: to } };
}

/**
 * Wizard targeting used by the summary and the ASSUMED audience estimate.
 * `schools` is a Figma 9b UI extension, only set while
 * `SCHOOL_TARGETING_SUPPORTED`; the strict backend create contract does not
 * support it. Omitted criteria mean "everyone"; an invalid age range is
 * dropped here and reported by `validateAudienceStep`.
 */
export type WizardTargeting = SurveyTargetingCriteria & { schools?: string[] };

export function toTargetingJson(draft: GoogleFormWizardDraft): WizardTargeting {
  const targeting: WizardTargeting = {};
  const age = checkAgeRange(draft);
  if (age.ok && age.range) targeting.ageRange = age.range;
  if (draft.gender !== "ALL") targeting.genders = [draft.gender];
  if (draft.fieldsOfStudy.length > 0) targeting.fieldOfStudy = [...draft.fieldsOfStudy];
  if (draft.location) targeting.locations = [draft.location];
  if (SCHOOL_TARGETING_SUPPORTED && draft.school) targeting.schools = [draft.school];
  return targeting;
}

/** Strict backend targeting contract; the UI-only school filter is always omitted. */
export function toBackendTargetingJson(draft: GoogleFormWizardDraft): SurveyTargetingCriteria {
  const targeting = { ...toTargetingJson(draft) };
  delete targeting.schools;
  return targeting;
}

export function criteriaCount(targeting: WizardTargeting): number {
  return [targeting.ageRange, targeting.genders, targeting.fieldOfStudy, targeting.locations, targeting.schools].filter(
    (criterion) => criterion !== undefined,
  ).length;
}

export function validateAudienceStep(draft: GoogleFormWizardDraft): WizardErrors {
  const age = checkAgeRange(draft);
  if (!age.ok) return { age: age.error };
  return criteriaCount(toTargetingJson(draft)) === 0 ? { criteria: CREATE_MESSAGES.criteriaRequired } : {};
}

/** "Trường Đại học FPT – Đà Nẵng" → "FPT – Đà Nẵng" (summaries). */
export function shortSchoolName(school: string): string {
  return school.replace(/^(Trường )?Đại học /, "").trim() || school;
}

/** Rows of Figma 9b "Tiêu chí đã chọn". */
export function criteriaSummary(draft: GoogleFormWizardDraft): { label: string; value: string }[] {
  const age = checkAgeRange(draft);
  const school = SCHOOL_TARGETING_SUPPORTED && draft.school ? shortSchoolName(draft.school) : "";
  const place = [school, draft.location].filter(Boolean).join(" · ");
  return [
    { label: "Giới tính", value: GENDER_CHOICES.find((choice) => choice.value === draft.gender)?.label ?? "Tất cả" },
    { label: "Tuổi", value: age.ok && age.range ? `${age.range.min} – ${age.range.max}` : "Tất cả" },
    { label: "Ngành", value: draft.fieldsOfStudy.length > 0 ? `${draft.fieldsOfStudy.length} ngành` : "Tất cả" },
    { label: SCHOOL_TARGETING_SUPPORTED ? "Trường · Khu vực" : "Khu vực", value: place || "Tất cả" },
  ];
}

/** Figma 9c "18–25 tuổi · 2 ngành · FPT Đà Nẵng" (only the criteria that are set). */
export function audienceSummaryLine(draft: GoogleFormWizardDraft): string {
  const targeting = toTargetingJson(draft);
  const parts: string[] = [];
  if (targeting.ageRange) parts.push(`${targeting.ageRange.min}–${targeting.ageRange.max} tuổi`);
  if (targeting.genders) parts.push(draft.gender === "MALE" ? "Nam" : "Nữ");
  if (targeting.fieldOfStudy) parts.push(`${targeting.fieldOfStudy.length} ngành`);
  if (targeting.schools) parts.push(shortSchoolName(targeting.schools[0]));
  if (targeting.locations) parts.push(targeting.locations[0]);
  return parts.length > 0 ? parts.join(" · ") : "Mọi người dùng";
}

// ---------------------------------------------------------------------------
// Step 3 · số mẫu & điểm (FR-14 band, escrow = sample × reward)
// ---------------------------------------------------------------------------

/** ASSUMED: "Hạn thu thập" choices (Figma 9c "14 ngày · đến 10/10/2026"). */
export const COLLECTION_DAY_CHOICES = [7, 14, 30] as const;
export const DEFAULT_COLLECTION_DAYS = 14;

const DATE_FORMAT = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

/** "14 ngày · đến 10/10/2026". */
export function collectionDaysLabel(days: number, now: Date = new Date()): string {
  return `${days} ngày · đến ${DATE_FORMAT.format(new Date(now.getTime() + days * 86_400_000))}`;
}

/** Positive integer or null (inputs are raw strings). */
function wholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

export function sampleSizeOf(draft: GoogleFormWizardDraft): number | null {
  const value = wholeNumber(draft.sampleSize);
  return value !== null && value >= 1 && value <= MAX_EXPECTED_COMPLETIONS ? value : null;
}

/** The typed reward per response (choosing a duration pre-fills the band's suggested value). */
export function rewardOf(draft: GoogleFormWizardDraft): number | null {
  return wholeNumber(draft.rewardPerResponse);
}

/** Clamp the stepper value into 1…100 000. */
export function stepSampleSize(raw: string, delta: number): string {
  const current = wholeNumber(raw) ?? DEFAULT_SAMPLE_SIZE;
  return String(Math.min(MAX_EXPECTED_COMPLETIONS, Math.max(1, current + delta)));
}

export function validateRewardStep(draft: GoogleFormWizardDraft): WizardErrors {
  const errors: WizardErrors = {};
  if (sampleSizeOf(draft) === null) errors.sampleSize = CREATE_MESSAGES.sampleInvalid;
  const range = rewardRangeOf(draft.durationBand);
  const reward = rewardOf(draft);
  if (range && (reward === null || reward < range.min || reward > range.max)) {
    errors.rewardPerResponse = CREATE_MESSAGES.rewardOutOfBand(range.min, range.max);
  }
  return errors;
}

export interface EscrowQuote {
  sample: number;
  reward: number;
  /** Points locked in escrow at publish (External: no discount). */
  cost: number;
  available: number;
  /** `available - cost` (negative when short). */
  remaining: number;
  shortfall: number;
  /** Largest sample the balance covers at this reward (9c' "Giảm còn 9 người"). */
  affordableSample: number;
}

/** Figma 9c/9c': cost = sample × points/lượt (`calculateEscrowCost`, EXTERNAL), vs available balance. */
export function escrowQuote(sample: number, reward: number, available: number): EscrowQuote {
  const cost = calculateEscrowCost({ type: "EXTERNAL", expectedCompletions: sample, rewardPerResponse: reward }).effectiveCost;
  return {
    sample,
    reward,
    cost,
    available,
    remaining: available - cost,
    shortfall: Math.max(0, cost - available),
    affordableSample: reward > 0 ? Math.min(MAX_EXPECTED_COMPLETIONS, Math.floor(available / reward)) : 0,
  };
}

// ---------------------------------------------------------------------------
// Navigation + request
// ---------------------------------------------------------------------------

export function validateStep(step: WizardStep, draft: GoogleFormWizardDraft): WizardErrors {
  if (step === 1) return validateInfoStep(draft);
  if (step === 2) return validateAudienceStep(draft);
  return validateRewardStep(draft);
}

export function hasErrors(errors: WizardErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** The furthest step the draft may open: a step needs every earlier step valid. */
export function reachableStep(requested: WizardStep, draft: GoogleFormWizardDraft): WizardStep {
  for (const step of WIZARD_STEPS) {
    if (step >= requested) break;
    if (hasErrors(validateStep(step, draft))) return step;
  }
  return requested;
}

/**
 * Body of `POST /forms/external` (VERIFIED `createExternalSurveySchema`) with
 * `autoPublish: true`: the backend creates the survey, checks the FR-14 band
 * and the 30-minute window, locks the escrow and queues it for moderation in
 * one unit of work (AD-16). UI-only topic, collection deadline and school
 * targeting are deliberately omitted until the backend persists them; the
 * create schema is strict. Null when a step is still invalid.
 */
export type CreateGoogleFormSurveyBody = Omit<
  CreateExternalSurveyInput,
  "targetingJson" | "rewardPerResponse" | "expectedCompletions"
> & {
  rewardPerResponse: number;
  expectedCompletions: number;
  targetingJson: SurveyTargetingCriteria;
};

export function toCreateRequest(draft: GoogleFormWizardDraft): CreateGoogleFormSurveyBody | null {
  if (WIZARD_STEPS.some((step) => hasErrors(validateStep(step, draft)))) return null;
  const url = checkGoogleFormsUrl(draft.externalUrl);
  const band = durationBandOf(draft.durationBand);
  const sample = sampleSizeOf(draft);
  const reward = rewardOf(draft);
  if (!url.valid || !band || sample === null || reward === null) return null;
  const description = draft.description.trim();
  return {
    title: draft.title.trim(),
    description: description || null,
    externalUrl: url.url,
    rewardPerResponse: reward,
    expectedCompletions: sample,
    expectedEffortSeconds: band.minutes * 60,
    estimatedDurationMinutes: band.minutes,
    targetingJson: toBackendTargetingJson(draft),
    autoPublish: true,
  };
}

// ---------------------------------------------------------------------------
// "Sửa & gửi lại" of a rejected Google Forms survey (`?from=<id>`)
// ---------------------------------------------------------------------------

/** The band whose FR-14 range covers `minutes` (dưới 5 · 5–10 · 10–15 · trên 15). */
export function durationBandForMinutes(minutes: number | null | undefined): DurationBandId | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 5) return "UNDER_5";
  if (minutes <= 10) return "FROM_5_TO_10";
  if (minutes <= 15) return "FROM_10_TO_15";
  return "OVER_15";
}

/** The fields of `GET /forms/:id` (VERIFIED `FormDetailDto`) the wizard reuses. */
export interface WizardPrefillSource {
  type: string;
  title: string;
  description?: string | null;
  rewardPerResponse: number;
  expectedCompletions: number;
  estimatedDurationMinutes?: number | null;
  currentVersion: { externalUrl?: string | null; targetingJson?: unknown };
}

type LooseTargeting = {
  ageRange?: { min?: unknown; max?: unknown };
  genders?: unknown;
  fieldOfStudy?: unknown;
  locations?: unknown;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * A fresh wizard draft from a rejected Google Forms survey: link, title,
 * description, duration band, targeting, sample and reward. Only values the
 * wizard can show are kept (a gender list other than exactly Nam or Nữ is
 * "Tất cả"; unknown fields of study / regions are dropped). Topic, deadline and
 * school are not stored by the backend, so they start empty. Null for an
 * in-Rescom survey.
 */
export function wizardDraftFromSurvey(source: WizardPrefillSource): GoogleFormWizardDraft | null {
  if (source.type !== "EXTERNAL") return null;
  const draft = emptyWizardDraft();
  const targeting = (
    source.currentVersion.targetingJson && typeof source.currentVersion.targetingJson === "object"
      ? source.currentVersion.targetingJson
      : {}
  ) as LooseTargeting;
  const min = targeting.ageRange?.min;
  const max = targeting.ageRange?.max;
  const genders = strings(targeting.genders);
  const location = strings(targeting.locations).find((item) => LOCATION_CHOICES.includes(item));
  return {
    ...draft,
    externalUrl: source.currentVersion.externalUrl ?? "",
    title: source.title,
    description: source.description ?? "",
    durationBand: durationBandForMinutes(source.estimatedDurationMinutes),
    gender: genders.length === 1 && (genders[0] === "MALE" || genders[0] === "FEMALE") ? genders[0] : "ALL",
    ageMin: typeof min === "number" && typeof max === "number" ? String(min) : "",
    ageMax: typeof min === "number" && typeof max === "number" ? String(max) : "",
    fieldsOfStudy: strings(targeting.fieldOfStudy).filter((field) => FIELD_OF_STUDY_CHOICES.includes(field)),
    location: location ?? "",
    sampleSize: source.expectedCompletions > 0 ? String(source.expectedCompletions) : draft.sampleSize,
    rewardPerResponse: source.rewardPerResponse > 0 ? String(source.rewardPerResponse) : "",
  };
}

/** True when the draft holds anything the Publisher typed (an untouched wizard is not "in progress"). */
export function isWizardDraftStarted(draft: GoogleFormWizardDraft): boolean {
  const empty = emptyWizardDraft();
  return (Object.keys(empty) as (keyof GoogleFormWizardDraft)[]).some(
    (key) => JSON.stringify(draft[key]) !== JSON.stringify(empty[key]),
  );
}
