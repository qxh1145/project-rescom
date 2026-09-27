import {
  demographicProfileStatusSchema,
  demographicSurveySubmissionResultSchema,
  type DemographicProfileStatusDto,
  type DemographicSurveySubmissionResultDto,
  type SubmitDemographicSurveyInput,
  type UpdateDemographicProfileInput,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Demographic profile + Mandatory Demographic Survey (Story 7.1, FR-6).
 * VERIFIED against `apps/backend/src/modules/users/presentation/demographics.controller.ts`
 * and `packages/schemas/src/users/demographic-profile.schema.ts`.
 * Failures surface as `ApiError` (400 `VALIDATION_ERROR` carries zod `details`).
 */

/** VERIFIED `GET /demographics` → the profile, `isComplete`, `missingFields`. */
export function getDemographics(signal?: AbortSignal): Promise<DemographicProfileStatusDto> {
  return apiRequest("/demographics", { schema: demographicProfileStatusSchema, signal });
}

/** VERIFIED `PUT /demographics` — partial edit (FR-9); `null` clears a field. */
export function updateDemographics(input: UpdateDemographicProfileInput): Promise<DemographicProfileStatusDto> {
  return apiRequest("/demographics", { method: "PUT", body: input, schema: demographicProfileStatusSchema });
}

/** VERIFIED `POST /demographics/survey` — every FR-6 field; answers with the next onboarding step. */
export function submitDemographicSurvey(
  input: SubmitDemographicSurveyInput,
): Promise<DemographicSurveySubmissionResultDto> {
  return apiRequest("/demographics/survey", {
    method: "POST",
    body: input,
    schema: demographicSurveySubmissionResultSchema,
  });
}
