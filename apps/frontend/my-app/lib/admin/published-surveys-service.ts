import {
  PUBLISHED_SURVEYS_MAX_LIMIT,
  publishedSurveyPageSchema,
  surveyPinResultSchema,
  type PublishedSurveyPage,
  type SurveyPinResult,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Admin "Đã đăng" tab. VERIFIED (`admin/presentation/admin-published-surveys.controller.ts`):
 * - `GET /admin/surveys/published?limit&offset&search` — pinned first, then most recently updated
 * - `PUT /admin/surveys/:formId/pin` `{ pinned }` — pinning needs a PUBLISHED survey
 */

export type { PublishedSurvey, PublishedSurveyPage } from "@rescom/schemas";

export function listPublishedSurveys(search: string, signal?: AbortSignal): Promise<PublishedSurveyPage> {
  const params = new URLSearchParams({ limit: String(PUBLISHED_SURVEYS_MAX_LIMIT) });
  if (search.trim()) params.set("search", search.trim());
  return apiRequest(`/admin/surveys/published?${params.toString()}`, { schema: publishedSurveyPageSchema, signal });
}

export function setSurveyPinned(formId: string, pinned: boolean): Promise<SurveyPinResult> {
  return apiRequest(`/admin/surveys/${encodeURIComponent(formId)}/pin`, {
    method: "PUT",
    body: { pinned },
    schema: surveyPinResultSchema,
  });
}
