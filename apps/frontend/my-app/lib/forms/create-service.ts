import { z } from "zod";
import { externalSurveyResponseSchema } from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import type { CreateGoogleFormSurveyBody, WizardTargeting } from "./create-wizard.ts";

export type CreatedExternalSurvey = z.infer<typeof externalSurveyResponseSchema>;

/**
 * VERIFIED: `POST /forms/external` (`forms.controller.ts#createExternalSurvey`,
 * session + CSRF, `createExternalSurveySchema`) → 201
 * `externalSurveyResponseSchema`: the created survey with the six-digit
 * `plaintextCompletionCode`, disclosed exactly once. With `autoPublish` the
 * survey goes straight to `MODERATION_QUEUE` and its escrow is locked.
 * Errors: 400 `VALIDATION_ERROR` / `PRICING_REWARD_OUT_OF_BAND`
 * (`{ min, max, suggested }`), 422 `SURVEY_DURATION_EXCEEDS_RESERVATION` /
 * `ESTIMATED_DURATION_REQUIRED`, 409 `INSUFFICIENT_ESCROW_BALANCE`
 * (`{ availableBalance, requiredAmount }`). The body is validated against the
 * strict shared `createExternalSurveySchema` before it reaches this service.
 */
export function createGoogleFormSurvey(
  body: CreateGoogleFormSurveyBody,
  idempotencyKey?: string,
): Promise<CreatedExternalSurvey> {
  return apiRequest("/forms/external", {
    method: "POST",
    body,
    schema: externalSurveyResponseSchema,
    // Decision C6 (a): a retry after a lost response replays the first creation
    // instead of locking the escrow twice (same key + same user → same response).
    ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
  });
}

export const audienceEstimateSchema = z.object({
  estimatedRespondents: z.number().int().nonnegative(),
});
export type AudienceEstimate = z.infer<typeof audienceEstimateSchema>;

/**
 * ASSUMED API CONTRACT: `POST /forms/audience-estimate` `{ targeting }` →
 * `{ estimatedRespondents }` — Figma 9b "Người phù hợp ước tính". No backend
 * route yet; the screen hides the number when the call fails.
 */
export function estimateAudience(targeting: WizardTargeting, signal?: AbortSignal): Promise<AudienceEstimate> {
  return apiRequest("/forms/audience-estimate", {
    method: "POST",
    body: { targeting },
    schema: audienceEstimateSchema,
    signal,
  });
}
