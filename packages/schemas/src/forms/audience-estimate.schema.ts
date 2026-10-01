import { z } from "zod";
import { surveyTargetingSchema } from "./form-targeting.schema";

/**
 * `POST /forms/audience-estimate` (mock-off plan 5.5, Figma 9b "Người phù hợp
 * ước tính"): roughly how many onboarded respondents match a draft's
 * targeting.
 *
 * Small-group protection (k = AUDIENCE_ESTIMATE_MIN_REPORTABLE): the server
 * (`AudienceEstimateService`) counts with the Marketplace / attempt-start
 * matcher (`isSurveyTargetingMatch`) and reports `estimatedRespondents: null`
 * ("Dưới 10") when the group — or any single value of an OR-ed list — has
 * fewer than k matches. Otherwise it adds a deterministic daily noise of ±3
 * and rounds with `toAudienceEstimate` (nearest 10 below 1 000, nearest 100
 * from 1 000, never below k). This makes reading a small group out of two
 * estimates harder; it is not a formal privacy guarantee.
 */
export const AUDIENCE_ESTIMATE_MIN_REPORTABLE = 10;

/** The strict backend targeting contract (the wizard's UI-only `schools` is never sent). */
export const audienceEstimateInputSchema = z
  .object({
    targeting: surveyTargetingSchema,
  })
  .strict();

export type AudienceEstimateInput = z.infer<typeof audienceEstimateInputSchema>;

export const audienceEstimateSchema = z
  .object({
    /** Rounded count, or null when fewer than `minimumReportable` respondents match. */
    estimatedRespondents: z.number().int().nonnegative().nullable(),
    minimumReportable: z.number().int().positive(),
  })
  .strict();

export type AudienceEstimateDto = z.infer<typeof audienceEstimateSchema>;

/** Applies the threshold and rounding above to an exact match count. */
export function toAudienceEstimate(exactCount: number): AudienceEstimateDto {
  const minimumReportable = AUDIENCE_ESTIMATE_MIN_REPORTABLE;
  if (!Number.isFinite(exactCount) || exactCount < minimumReportable) {
    return { estimatedRespondents: null, minimumReportable };
  }
  const step = exactCount < 1000 ? 10 : 100;
  const rounded = Math.round(exactCount / step) * step;
  return {
    estimatedRespondents: Math.max(minimumReportable, rounded),
    minimumReportable,
  };
}
