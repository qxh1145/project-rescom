import {
  publisherAnalyticsSchema,
  type ChoiceSummary,
  type NumberSummary,
  type PublisherAnalyticsDto,
  type QuestionAnalytics,
  type QuestionSummary,
  type ScaleSummary,
  type TextSummary,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Survey response analytics (Câu trả lời → Tóm tắt / Theo câu hỏi).
 *
 * | Endpoint | Label |
 * |---|---|
 * | `GET /forms/:id/analytics[?versionNumber=]` | VERIFIED (Story IR.4a Q1, shared `publisherAnalyticsSchema`) — per-question aggregation of one version |
 *
 * The backend aggregates (the shared `aggregateFormAnalytics`, also used by
 * MSW); the client only formats. Version selection and errors match
 * `GET /forms/:id/responses` (`results-service.ts`): owner only, 404
 * `FORM_NOT_FOUND` / `FORM_VERSION_NOT_FOUND`, 422
 * `PUBLISHER_ANALYTICS_LIMIT_EXCEEDED` above the scan cap. Google Forms
 * surveys answer `NOT_APPLICABLE`.
 *
 * `percentage` = count / `answeredCount` × 100, one decimal, computed
 * server-side. A multiple-choice question uses the same denominator (people
 * who answered it), so its percentages may add up to more than 100 — never
 * normalised.
 */

export const formAnalyticsSchema = publisherAnalyticsSchema;
export type FormAnalytics = PublisherAnalyticsDto;
/** Analytics of an Internal survey (narrowed on `availability`). */
export type AvailableFormAnalytics = Extract<FormAnalytics, { availability: "AVAILABLE" }>;
export type { ChoiceSummary, NumberSummary, QuestionAnalytics, QuestionSummary, ScaleSummary, TextSummary };

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
