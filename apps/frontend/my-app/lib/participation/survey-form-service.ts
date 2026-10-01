import { surveySummarySchema, type SurveySummaryDto } from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * VERIFIED: `GET /surveys/:id` (`survey-runner.controller.ts`, public) →
 * `surveySummarySchema` (strict) — the public facts of one PUBLISHED survey
 * for screens reached without the feed: the consent screen (Figma 14: title,
 * "Trong Rescom", "5 phút", "+12 điểm") and 18.7 "Khảo sát đã đủ người"
 * (responses / quota). No publisher, targeting or external link. Unknown,
 * draft and closed surveys are one 404 `SURVEY_NOT_FOUND`.
 *
 * The questions of an attempt come from `GET /attempts/:id` (`form`, the
 * PINNED version), never from `GET /public/forms/:id` (guest route, current
 * version, refuses `requireAuth` forms).
 */
export { surveySummarySchema };
export type SurveySummary = SurveySummaryDto;

export function getSurveySummary(surveyId: string, signal?: AbortSignal): Promise<SurveySummary> {
  return apiRequest(`/surveys/${encodeURIComponent(surveyId)}`, { schema: surveySummarySchema, signal });
}
