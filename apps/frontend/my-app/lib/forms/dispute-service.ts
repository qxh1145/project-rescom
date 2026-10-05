import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Publisher complaint about a Google Forms attempt (Figma 10c, FR-24, Story
 * 8.5 deferred). The route stays on MSW in the hybrid mode of gate G
 * (`PUBLISHER_DISPUTES_ENABLED`, `results-scope.ts`); the backend has no
 * Publisher dispute route.
 */

/** ASSUMED: why a Publisher disputes a Google Forms attempt (Figma 10c chips). */
export const DISPUTE_REASONS = ["LOW_EFFORT", "NO_MATCHING_RESPONSE", "DUPLICATE_RESPONDENT", "OTHER"] as const;
export const disputeReasonSchema = z.enum(DISPUTE_REASONS);
export type DisputeReason = z.infer<typeof disputeReasonSchema>;

const disputeSchema = z.object({
  id: z.string(),
  status: z.enum(["OPEN", "UPHELD", "DISMISSED"]),
  reason: disputeReasonSchema,
  createdAt: z.string(),
});

export const disputeResultSchema = z.object({
  attemptId: z.string(),
  dispute: disputeSchema,
});
export type DisputeResult = z.infer<typeof disputeResultSchema>;

export interface DisputeInput {
  reason: DisputeReason;
  description: string;
}

/**
 * ASSUMED API CONTRACT: `POST /forms/:id/attempts/:attemptId/disputes`
 * (Figma 10c, FR-24). The backend holds the reward of a disputed Google Forms
 * attempt (`external-dispute:` ledger hold) but exposes no Publisher route yet.
 */
export function submitAttemptDispute(formId: string, attemptId: string, input: DisputeInput): Promise<DisputeResult> {
  return apiRequest(`/forms/${encodeURIComponent(formId)}/attempts/${encodeURIComponent(attemptId)}/disputes`, {
    method: "POST",
    body: input,
    schema: disputeResultSchema,
  });
}
