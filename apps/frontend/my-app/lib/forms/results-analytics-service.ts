import { formBlockTypeEnum, formTypeEnum } from "@rescom/schemas";
import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Survey response analytics (Câu trả lời → Tóm tắt / Theo câu hỏi).
 *
 * | Endpoint | Label |
 * |---|---|
 * | `GET /forms/:id/analytics[?versionNumber=]` | ASSUMED API CONTRACT — per-question aggregation of one version |
 *
 * The backend aggregates; the client only formats. Version selection and
 * errors match `GET /forms/:id/responses` (`results-service.ts`): owner or
 * ADMIN only, 404 `FORM_NOT_FOUND` / `FORM_VERSION_NOT_FOUND`, 403 `FORM_FORBIDDEN`.
 *
 * `percentage` = count / `answeredCount` × 100, one decimal, computed
 * server-side. A multiple-choice question uses the same denominator (people
 * who answered it), so its percentages may add up to more than 100 — never
 * normalised.
 */

const isoDate = z.string().min(1);
const count = z.number().int().nonnegative();
const percentage = z.number().nonnegative();

export const choiceSummarySchema = z.object({
  kind: z.literal("choice"),
  /** multiple_choice: one respondent may pick several options. */
  multiple: z.boolean(),
  /** Every option of the version, in form order (zero counts included). */
  options: z.array(z.object({ value: z.string(), label: z.string(), count, percentage })),
  /** Free "Khác" answers (block `allowOther`); null when the question has none. */
  other: z.object({ count, percentage, samples: z.array(z.string()) }).nullable(),
});

export const scaleSummarySchema = z.object({
  kind: z.literal("scale"),
  min: z.number().int(),
  max: z.number().int(),
  minLabel: z.string().nullable(),
  maxLabel: z.string().nullable(),
  /** One bucket per point min..max (zero counts included). */
  buckets: z.array(z.object({ value: z.number().int(), count, percentage })),
  average: z.number().nullable(),
  median: z.number().nullable(),
});

export const numberSummarySchema = z.object({
  kind: z.literal("number"),
  average: z.number().nullable(),
  median: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  /** At most 8 bins, ascending ("0–500"). */
  buckets: z.array(z.object({ label: z.string(), count, percentage })),
});

export const textSummarySchema = z.object({
  kind: z.literal("text"),
  /** Newest first, at most 5 — the full list comes from `GET /forms/:id/responses`. */
  samples: z.array(z.object({ responseId: z.string(), value: z.string(), submittedAt: isoDate })),
});

export const fileSummarySchema = z.object({ kind: z.literal("file") });

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

export const questionAnalyticsSchema = z.object({
  questionId: z.string(),
  /** 1-based position in the version ("Câu 3"). */
  number: z.number().int().positive(),
  title: z.string(),
  type: formBlockTypeEnum,
  required: z.boolean(),
  /** Responses with a non-empty answer — the percentage denominator. */
  answeredCount: count,
  skippedCount: count,
  summary: questionSummarySchema,
});
export type QuestionAnalytics = z.infer<typeof questionAnalyticsSchema>;

export const formAnalyticsSchema = z.object({
  form: z.object({
    id: z.string(),
    title: z.string(),
    type: formTypeEnum,
    versionNumber: z.number().int().positive(),
  }),
  totalResponses: count,
  /** Attempts started on the version; null = unknown (completion rate hidden). */
  startedCount: count.nullable(),
  averageDurationSeconds: z.number().nonnegative().nullable(),
  lastResponseAt: isoDate.nullable(),
  /** Form order; empty for Google Forms surveys (answers stay in Google). */
  questions: z.array(questionAnalyticsSchema),
});
export type FormAnalytics = z.infer<typeof formAnalyticsSchema>;

export function getFormAnalytics(
  formId: string,
  versionNumber?: number | null,
  signal?: AbortSignal,
): Promise<FormAnalytics> {
  const query = versionNumber ? `?versionNumber=${encodeURIComponent(String(versionNumber))}` : "";
  return apiRequest(`/forms/${encodeURIComponent(formId)}/analytics${query}`, {
    schema: formAnalyticsSchema,
    signal,
  });
}
