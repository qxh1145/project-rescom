import {
  aggregateFormAnalytics,
  analyticsMedian,
  analyticsNumberBuckets,
  analyticsPercentOf,
  type AnalyticsQuestion,
} from "@rescom/schemas";
import type { AvailableFormAnalytics } from "@/lib/forms/results-analytics-service";
import type { MockFormResponse } from "./form-responses";

/**
 * MSW side of `GET /forms/:id/analytics` (Story IR.4a AC1.2): a thin wrapper
 * around the shared `aggregateFormAnalytics` of `@rescom/schemas`, the same
 * function the backend runs, so mock and backend cannot drift. The
 * aggregation rules are documented there.
 */

export const percentOf = analyticsPercentOf;
export const median = analyticsMedian;
export const numberBuckets = analyticsNumberBuckets;

export interface BuildFormAnalyticsInput {
  form: { id: string; title: string; versionId: string; versionNumber: number };
  /** Output of `toPublisherQuestions(version.blocks)` (form order). */
  questions: readonly AnalyticsQuestion[];
  /** Responses of the version, newest first. */
  rows: readonly Pick<MockFormResponse, "id" | "submittedAt" | "answers">[];
}

export function buildFormAnalytics({ form, questions, rows }: BuildFormAnalyticsInput): AvailableFormAnalytics {
  return {
    availability: "AVAILABLE",
    form: { id: form.id, title: form.title, type: "INTERNAL", versionId: form.versionId, versionNumber: form.versionNumber },
    ...aggregateFormAnalytics(
      questions,
      rows.map((row) => ({ id: row.id, submittedAt: row.submittedAt, answers: row.answers })),
    ),
  };
}
