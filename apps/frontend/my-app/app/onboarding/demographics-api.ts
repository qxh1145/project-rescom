import {
  demographicProfileStatusSchema,
  demographicSurveySubmissionResultSchema,
  type DemographicProfileStatusDto,
  type DemographicSurveySubmissionResultDto,
  type SubmitDemographicSurveyInput,
  type UpdateDemographicProfileInput,
} from "@rescom/schemas";
import { formMutationFetch } from "../forms/forms-api.ts";

/**
 * Typed live-API client for the demographic profile and the Mandatory
 * Demographic Survey (Story 7.1). The demo UI uses the mock repository; this
 * client is ready for the later API swap. Errors keep the backend `code`
 * (e.g. `DEMOGRAPHIC_PROFILE_REQUIRED`, `VALIDATION_ERROR`) and `details`.
 */

export type DemographicsApiError = Error & { code?: string; details?: unknown };

export interface DemographicsRequestOptions {
  signal?: AbortSignal;
}

function apiError(payload: unknown, fallback: string): DemographicsApiError {
  const body = payload as {
    error?: { message?: string; code?: string; details?: unknown };
  } | null;
  const error = new Error(body?.error?.message || fallback) as DemographicsApiError;
  error.code = body?.error?.code;
  error.details = body?.error?.details;
  return error;
}

async function readData<T>(
  res: Response,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  fallback: string,
): Promise<T> {
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw apiError(payload, fallback);
  }
  const parsed = schema.safeParse(payload?.data);
  if (!parsed.success || parsed.data === undefined) {
    throw new Error("Received a malformed demographic profile response from the server");
  }
  return parsed.data;
}

/** `GET /demographics` — the profile plus its completeness. */
export async function fetchDemographicProfile(
  options: DemographicsRequestOptions = {},
): Promise<DemographicProfileStatusDto> {
  const res = await fetch("/api/demographics", {
    signal: options.signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return readData(res, demographicProfileStatusSchema, "Failed to load demographic profile");
}

/** `PUT /demographics` — partial profile edit (FR-9). */
export async function updateDemographicProfile(
  input: UpdateDemographicProfileInput,
): Promise<DemographicProfileStatusDto> {
  const res = await formMutationFetch("/api/demographics", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  return readData(res, demographicProfileStatusSchema, "Failed to update demographic profile");
}

/** `POST /demographics/survey` — Mandatory Demographic Survey submission (FR-6). */
export async function submitDemographicSurvey(
  input: SubmitDemographicSurveyInput,
): Promise<DemographicSurveySubmissionResultDto> {
  const res = await formMutationFetch("/api/demographics/survey", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  return readData(
    res,
    demographicSurveySubmissionResultSchema,
    "Failed to submit the demographic survey",
  );
}
