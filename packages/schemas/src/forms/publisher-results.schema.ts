import { z } from "zod";
import { formBlockTypeEnum, type FormBlockType } from "./form-blocks.schema";
import { formStatusEnum } from "./form-draft.schema";
import {
  asciiToBase64Url,
  base64UrlToAscii,
} from "../economy/starter-points.schema";

/**
 * Story IR.4a: Publisher progress and response viewing (FR-39, FR-40).
 * One contract per endpoint, shared by the backend controllers, the frontend
 * services and the MSW handlers:
 *
 * - `GET /forms/:id/progress?range=`            → `publisherProgressSchema`
 * - `GET /forms/:id/responses[?versionNumber&cursor&limit]` → `publisherResponsesPageSchema`
 * - `GET /forms/:id/analytics[?versionNumber]`  → `publisherAnalyticsSchema`
 * - `GET /forms/:id/versions/:versionId`        → `publisherFormVersionDetailSchema`
 *
 * Owner only: anybody else (an Admin included) gets 404 `FORM_NOT_FOUND`.
 * Response DTOs are `.strict()`, so a leaked field (`respondentId`,
 * `attemptId`, …) fails parsing (AD-18 privacy guard).
 */

// ---------------------------------------------------------------------------
// Error codes and limits
// ---------------------------------------------------------------------------

export const FORM_VERSION_NOT_FOUND_CODE = "FORM_VERSION_NOT_FOUND";
export const INVALID_CURSOR_CODE = "INVALID_CURSOR";
export const PUBLISHER_ANALYTICS_LIMIT_EXCEEDED_CODE =
  "PUBLISHER_ANALYTICS_LIMIT_EXCEEDED";

export const PUBLISHER_RESPONSES_PAGE_LIMIT_DEFAULT = 50;
export const PUBLISHER_RESPONSES_PAGE_LIMIT_MAX = 100;
/** Analytics refuses (422) above this many listed responses per version (NFR-30). */
export const PUBLISHER_ANALYTICS_MAX_RESPONSES = 5000;

const count = z.number().int().nonnegative();
const isoInstant = z.string().datetime({ offset: true });
const entityId = z.string().min(1);

// ---------------------------------------------------------------------------
// Progress: GET /forms/:id/progress?range=hour|day|week|month
// ---------------------------------------------------------------------------

export const PUBLISHER_PROGRESS_RANGES = ["hour", "day", "week", "month"] as const;
export const publisherProgressRangeSchema = z.enum(PUBLISHER_PROGRESS_RANGES);
export type PublisherProgressRange = z.infer<typeof publisherProgressRangeSchema>;

/** Buckets are computed in Vietnam time (UTC+7, no daylight saving). */
export const PUBLISHER_RESULTS_TIME_ZONE = "Asia/Ho_Chi_Minh";
const VN_OFFSET_MS = 7 * 3_600_000;
const HOUR_MS = 3_600_000;

export const publisherProgressQuerySchema = z
  .object({ range: publisherProgressRangeSchema.default("day") })
  .strict();
export type PublisherProgressQuery = z.infer<typeof publisherProgressQuerySchema>;

export const publisherProgressBucketSchema = z
  .object({ startsAt: isoInstant, endsAt: isoInstant, count })
  .strict();

export const publisherProgressSchema = z
  .object({
    formId: entityId,
    status: formStatusEnum,
    /** Completed participations (same count as `GET /forms/:id` `completedCompletions`). */
    completed: count,
    expected: count,
    /** Ledger-posted Escrow consumption ("Điểm đã chi"). */
    pointsSpent: count,
    /** Same value as `GET /forms/:id` `escrowLocked`. */
    escrowRemaining: count,
    /** `forms.deadline_at`; null = no deadline. */
    deadlineAt: isoInstant.nullable(),
    /**
     * Google Forms completions still inside their 48 h review
     * (`EXTERNAL_COMPLETION_REVIEW_HOURS`). null for an Internal form.
     */
    pendingAttempts: count.nullable(),
    /** Completions per bucket (FR-39 time series), oldest first, zero-filled. */
    completionsSeries: z
      .object({
        range: publisherProgressRangeSchema,
        timeZone: z.literal(PUBLISHER_RESULTS_TIME_ZONE),
        total: count,
        buckets: z.array(publisherProgressBucketSchema),
      })
      .strict(),
  })
  .strict();
export type PublisherProgressDto = z.infer<typeof publisherProgressSchema>;

export interface ProgressWindowBucket {
  startsAt: Date;
  endsAt: Date;
}

/** Vietnam wall-clock fields of an instant (UTC getters on the shifted time). */
function localParts(instant: Date) {
  const local = new Date(instant.getTime() + VN_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    /** 0 = Monday … 6 = Sunday. */
    isoWeekday: (local.getUTCDay() + 6) % 7,
  };
}

/** The instant of a Vietnam wall-clock time (month/day may overflow, like Date.UTC). */
function fromLocal(year: number, month: number, day: number, hour = 0): Date {
  return new Date(Date.UTC(year, month, day, hour) - VN_OFFSET_MS);
}

/**
 * The zero-filled bucket windows of a progress range, oldest first; the last
 * bucket contains `now`:
 * - `hour`: 8 × 3 h, aligned to local 3-hour boundaries (the last 24 h);
 * - `day`: 7 local days ending today;
 * - `week`: 4 ISO weeks (Monday start) ending the current week;
 * - `month`: 6 local calendar months ending the current month.
 */
export function publisherProgressWindow(
  range: PublisherProgressRange,
  now: Date,
): ProgressWindowBucket[] {
  const local = localParts(now);
  const buckets: ProgressWindowBucket[] = [];
  switch (range) {
    case "hour": {
      const current = fromLocal(local.year, local.month, local.day, local.hour - (local.hour % 3));
      for (let index = 7; index >= 0; index -= 1) {
        const startsAt = new Date(current.getTime() - index * 3 * HOUR_MS);
        buckets.push({ startsAt, endsAt: new Date(startsAt.getTime() + 3 * HOUR_MS) });
      }
      break;
    }
    case "day": {
      for (let index = 6; index >= 0; index -= 1) {
        buckets.push({
          startsAt: fromLocal(local.year, local.month, local.day - index),
          endsAt: fromLocal(local.year, local.month, local.day - index + 1),
        });
      }
      break;
    }
    case "week": {
      const monday = local.day - local.isoWeekday;
      for (let index = 3; index >= 0; index -= 1) {
        buckets.push({
          startsAt: fromLocal(local.year, local.month, monday - index * 7),
          endsAt: fromLocal(local.year, local.month, monday - index * 7 + 7),
        });
      }
      break;
    }
    case "month": {
      for (let index = 5; index >= 0; index -= 1) {
        buckets.push({
          startsAt: fromLocal(local.year, local.month - index, 1),
          endsAt: fromLocal(local.year, local.month - index + 1, 1),
        });
      }
      break;
    }
  }
  return buckets;
}

/** Counts `instants` into the window (an instant outside it is ignored). */
export function countIntoProgressWindow(
  window: readonly ProgressWindowBucket[],
  instants: Iterable<Date>,
): number[] {
  const counts = window.map(() => 0);
  for (const instant of instants) {
    const time = instant.getTime();
    const index = window.findIndex(
      (bucket) => time >= bucket.startsAt.getTime() && time < bucket.endsAt.getTime(),
    );
    if (index >= 0) counts[index] += 1;
  }
  return counts;
}

/** The DTO series of a window and its counts. */
export function toCompletionsSeries(
  range: PublisherProgressRange,
  window: readonly ProgressWindowBucket[],
  counts: readonly number[],
): PublisherProgressDto["completionsSeries"] {
  const buckets = window.map((bucket, index) => ({
    startsAt: bucket.startsAt.toISOString(),
    endsAt: bucket.endsAt.toISOString(),
    count: counts[index] ?? 0,
  }));
  return {
    range,
    timeZone: PUBLISHER_RESULTS_TIME_ZONE,
    total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    buckets,
  };
}

// ---------------------------------------------------------------------------
// Responses: GET /forms/:id/responses
// ---------------------------------------------------------------------------

const versionNumberQuery = z.coerce.number().int().positive();

export const publisherResponsesQuerySchema = z
  .object({
    versionNumber: versionNumberQuery.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PUBLISHER_RESPONSES_PAGE_LIMIT_MAX)
      .default(PUBLISHER_RESPONSES_PAGE_LIMIT_DEFAULT),
  })
  .strict();
export type PublisherResponsesQuery = z.infer<typeof publisherResponsesQuerySchema>;

export const publisherResponseQuestionSchema = z
  .object({
    id: z.string(),
    /** 1-based position in the version ("C3", "Câu 3"). */
    number: z.number().int().positive(),
    title: z.string(),
    type: formBlockTypeEnum,
    required: z.boolean(),
    options: z.array(z.object({ value: z.string(), label: z.string() }).strict()),
    /** The choice question accepts a free "Khác" answer (stored as its text). */
    allowOther: z.boolean(),
    scale: z
      .object({
        min: z.number(),
        max: z.number(),
        minLabel: z.string().nullable(),
        maxLabel: z.string().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PublisherResponseQuestion = z.infer<typeof publisherResponseQuestionSchema>;

export const publisherResponseAnswerValueSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.string()),
  z.null(),
]);
export type PublisherResponseAnswerValue = z.infer<typeof publisherResponseAnswerValueSchema>;

/** Spine "Integrity Applicability": Phase 1 never assesses response quality (Epic 10 deferred). */
export const responseIntegritySchema = z
  .object({ applicability: z.literal("NOT_ASSESSED") })
  .strict();

export const publisherResponseRowSchema = z
  .object({
    id: entityId,
    /** Per-response pseudonym ("47AD9F"), never linkable across forms. */
    code: z.string().min(1),
    formVersionId: entityId,
    submittedAt: isoInstant,
    /** `null` when no attempt start is known (guest response). */
    durationSeconds: count.nullable(),
    integrity: responseIntegritySchema,
    /** Keyed by block id of the pinned version. */
    answers: z.record(publisherResponseAnswerValueSchema),
  })
  .strict();
export type PublisherResponseRow = z.infer<typeof publisherResponseRowSchema>;

const notApplicableForm = z
  .object({
    id: entityId,
    title: z.string(),
    type: z.literal("EXTERNAL"),
    externalUrl: z.string().nullable(),
  })
  .strict();

const availableForm = z
  .object({
    id: entityId,
    title: z.string(),
    type: z.literal("INTERNAL"),
    versionId: entityId,
    versionNumber: z.number().int().positive(),
  })
  .strict();

/** Google Forms answers stay in Google: an explicit result, never an empty list. */
export const publisherResultsNotApplicableSchema = z
  .object({
    availability: z.literal("NOT_APPLICABLE"),
    reason: z.literal("EXTERNAL_FORM"),
    form: notApplicableForm,
  })
  .strict();

export const publisherResponsesPageSchema = z.discriminatedUnion("availability", [
  z
    .object({
      availability: z.literal("AVAILABLE"),
      form: availableForm,
      questions: z.array(publisherResponseQuestionSchema),
      /** Newest first (`submittedAt DESC, id DESC`). */
      responses: z.array(publisherResponseRowSchema),
      /** Listed responses of the version (all pages). */
      totalCount: count,
      /** Opaque keyset cursor of the next page; null on the last page. */
      nextCursor: z.string().min(1).nullable(),
    })
    .strict(),
  publisherResultsNotApplicableSchema,
]);
export type PublisherResponsesPage = z.infer<typeof publisherResponsesPageSchema>;

// ---------------------------------------------------------------------------
// Responses cursor (base64url JSON, Node and browser)
// ---------------------------------------------------------------------------

export const publisherResponsesCursorSchema = z
  .object({
    v: z.literal(1),
    versionId: z.string().uuid(),
    submittedAt: z.string().datetime(),
    id: z.string().uuid(),
  })
  .strict();
export type PublisherResponsesCursor = z.infer<typeof publisherResponsesCursorSchema>;

export function encodePublisherResponsesCursor(
  cursor: Omit<PublisherResponsesCursor, "v">,
): string {
  return asciiToBase64Url(
    JSON.stringify({
      v: 1,
      versionId: cursor.versionId,
      submittedAt: cursor.submittedAt,
      id: cursor.id,
    }),
  );
}

/** The cursor in a token, or `null` unless the token is exactly one we issue. */
export function decodePublisherResponsesCursor(
  token: string,
): PublisherResponsesCursor | null {
  const json = base64UrlToAscii(token);
  if (json === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = publisherResponsesCursorSchema.safeParse(value);
  if (!parsed.success) return null;
  return encodePublisherResponsesCursor(parsed.data) === token ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Question projection of a version's stored blocks
// ---------------------------------------------------------------------------

const BLOCK_TYPES: readonly string[] = formBlockTypeEnum.options;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const nullableText = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const finite = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * The questions of a version from its stored `schemaJson.blocks`, sorted by
 * `order` (form order); `number` = position + 1. Read defensively: a stored
 * block of an unknown type, or without an id, is skipped.
 */
export function toPublisherQuestions(blocks: readonly unknown[]): PublisherResponseQuestion[] {
  return blocks
    .map((raw, index) => ({ block: asRecord(raw), index }))
    .filter(
      (item): item is { block: Record<string, unknown>; index: number } =>
        item.block !== null &&
        typeof item.block.id === "string" &&
        BLOCK_TYPES.includes(String(item.block.type)),
    )
    .sort((a, b) => finite(a.block.order, a.index) - finite(b.block.order, b.index) || a.index - b.index)
    .map(({ block }, position) => {
      const type = block.type as FormBlockType;
      const isChoice = type === "single_choice" || type === "multiple_choice";
      const options = isChoice && Array.isArray(block.options)
        ? block.options
            .map(asRecord)
            .filter((option): option is Record<string, unknown> => option !== null)
            .map((option) => ({
              value: text(option.value, text(option.label)),
              label: text(option.label, text(option.value)),
            }))
        : [];
      let scale: PublisherResponseQuestion["scale"] = null;
      if (type === "linear_scale") {
        scale = {
          min: finite(block.min, 1),
          max: finite(block.max, 5),
          minLabel: nullableText(block.minLabel),
          maxLabel: nullableText(block.maxLabel),
        };
      } else if (type === "rating") {
        scale = { min: 1, max: finite(block.maxRating, 5), minLabel: null, maxLabel: null };
      }
      return {
        id: block.id as string,
        number: position + 1,
        title: text(block.title),
        type,
        required: block.required === true,
        options,
        allowOther: isChoice && block.allowOther === true,
        scale,
      };
    });
}

/** One stored answer item as the Publisher may see it (IR.4a Privacy rule 5). */
function projectAnswerItem(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (typeof item === "number" && Number.isFinite(item)) return String(item);
  if (typeof item === "boolean") return String(item);
  // A stored file answer: its file name only (Q11), never the object id/key.
  const record = asRecord(item);
  return record && typeof record.fileName === "string" ? record.fileName : null;
}

function projectAnswerValue(value: unknown): PublisherResponseAnswerValue | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map(projectAnswerItem).filter((item): item is string => item !== null);
  }
  return undefined;
}

/**
 * Explicit answer projection (AD-18), shared by the backend and MSW: only
 * keys that are questions of the pinned version; strings, finite numbers and
 * string arrays pass, booleans become text, file answers become their file
 * names, anything else is dropped.
 */
export function projectPublisherAnswers(
  answers: unknown,
  questions: readonly Pick<PublisherResponseQuestion, "id">[],
): Record<string, PublisherResponseAnswerValue> {
  const result: Record<string, PublisherResponseAnswerValue> = {};
  const stored = asRecord(answers);
  if (!stored) return result;
  for (const question of questions) {
    if (!Object.prototype.hasOwnProperty.call(stored, question.id)) continue;
    const value = projectAnswerValue(stored[question.id]);
    if (value !== undefined) result[question.id] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Analytics: GET /forms/:id/analytics
// ---------------------------------------------------------------------------

export const publisherAnalyticsQuerySchema = z
  .object({ versionNumber: versionNumberQuery.optional() })
  .strict();
export type PublisherAnalyticsQuery = z.infer<typeof publisherAnalyticsQuerySchema>;

const percentage = z.number().nonnegative();

export const choiceSummarySchema = z
  .object({
    kind: z.literal("choice"),
    /** multiple_choice: one respondent may pick several options. */
    multiple: z.boolean(),
    /** Every option of the version, in form order (zero counts included). */
    options: z.array(
      z.object({ value: z.string(), label: z.string(), count, percentage }).strict(),
    ),
    /** Free "Khác" answers (block `allowOther`); null when the question has none. */
    other: z
      .object({ count, percentage, samples: z.array(z.string()) })
      .strict()
      .nullable(),
  })
  .strict();

export const scaleSummarySchema = z
  .object({
    kind: z.literal("scale"),
    min: z.number().int(),
    max: z.number().int(),
    minLabel: z.string().nullable(),
    maxLabel: z.string().nullable(),
    /** One bucket per point min..max (zero counts included). */
    buckets: z.array(z.object({ value: z.number().int(), count, percentage }).strict()),
    average: z.number().nullable(),
    median: z.number().nullable(),
  })
  .strict();

export const numberSummarySchema = z
  .object({
    kind: z.literal("number"),
    average: z.number().nullable(),
    median: z.number().nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    /** At most 8 bins, ascending ("0–500"). */
    buckets: z.array(z.object({ label: z.string(), count, percentage }).strict()),
  })
  .strict();

export const textSummarySchema = z
  .object({
    kind: z.literal("text"),
    /** Newest first, at most 5 — the full list comes from `GET /forms/:id/responses`. */
    samples: z.array(
      z.object({ responseId: entityId, value: z.string(), submittedAt: isoInstant }).strict(),
    ),
  })
  .strict();

export const fileSummarySchema = z.object({ kind: z.literal("file") }).strict();

export const questionSummarySchema = z.discriminatedUnion("kind", [
  choiceSummarySchema,
  scaleSummarySchema,
  numberSummarySchema,
  textSummarySchema,
  fileSummarySchema,
]);
export type QuestionSummary = z.infer<typeof questionSummarySchema>;
export type ChoiceSummary = z.infer<typeof choiceSummarySchema>;
export type ScaleSummary = z.infer<typeof scaleSummarySchema>;
export type NumberSummary = z.infer<typeof numberSummarySchema>;
export type TextSummary = z.infer<typeof textSummarySchema>;

export const questionAnalyticsSchema = z
  .object({
    questionId: z.string(),
    /** 1-based position in the version ("Câu 3"). */
    number: z.number().int().positive(),
    title: z.string(),
    type: formBlockTypeEnum,
    required: z.boolean(),
    /** Responses with a counted answer — the percentage denominator. */
    answeredCount: count,
    skippedCount: count,
    summary: questionSummarySchema,
  })
  .strict();
export type QuestionAnalytics = z.infer<typeof questionAnalyticsSchema>;

export const publisherAnalyticsSchema = z.discriminatedUnion("availability", [
  z
    .object({
      availability: z.literal("AVAILABLE"),
      form: availableForm,
      totalResponses: count,
      lastResponseAt: isoInstant.nullable(),
      /** Form order. */
      questions: z.array(questionAnalyticsSchema),
    })
    .strict(),
  publisherResultsNotApplicableSchema,
]);
export type PublisherAnalyticsDto = z.infer<typeof publisherAnalyticsSchema>;

/** 422 `PUBLISHER_ANALYTICS_LIMIT_EXCEEDED` details. */
export interface PublisherAnalyticsLimitDetails {
  totalResponses: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Version detail: GET /forms/:id/versions/:versionId
// ---------------------------------------------------------------------------

export const publisherFormVersionDetailSchema = z
  .object({
    id: entityId,
    formId: entityId,
    versionNumber: z.number().int().positive(),
    isPublished: z.boolean(),
    publishedAt: isoInstant.nullable(),
    createdAt: isoInstant,
    externalUrl: z.string().nullable(),
    /** The stored definition (owner-authored). Never `completionCode` / `targetingJson`. */
    schemaJson: z
      .object({ blocks: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()) })
      .passthrough(),
  })
  .strict();
export type PublisherFormVersionDetailDto = z.infer<typeof publisherFormVersionDetailSchema>;
