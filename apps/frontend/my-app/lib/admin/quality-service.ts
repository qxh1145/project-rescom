import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Admin "Xem xét chất lượng" (Figma 17b, 63:3276): rewards held in the
 * respondent's INTEGRITY_HOLD under an ENFORCED policy (respondent side: 17c
 * "Điểm đang giữ để xét").
 *
 * Backend today (VERIFIED in `ledger.service.ts`): `creditInternalReward`
 * posts the `integrity-hold:{responseId}` journal, `releaseIntegrityHold`
 * (key `integrity-decision:{decisionId}`) moves it to USER_AVAILABLE, and
 * `POST /economy/journals/:id/reverse` (ADMIN) can reverse the hold journal.
 * No controller exposes the review queue or `releaseIntegrityHold`, so both
 * routes below are ASSUMED API CONTRACT:
 * - `GET /admin/quality-reviews` → `{ items, total }`, open reviews newest first;
 * - `POST /admin/quality-reviews/:responseId/decision` (CSRF) with
 *   `{ decision, note }`: `ACCEPT` / `INSUFFICIENT_EVIDENCE` release the hold
 *   (`releaseIntegrityHold`), `REJECT` reverses it (points back to the
 *   publisher's escrow) and needs a note. The decision is an immutable
 *   calibration label; the respondent is notified and may appeal.
 *   Errors: 404 `QUALITY_REVIEW_NOT_FOUND`, 409 `QUALITY_REVIEW_ALREADY_DECIDED`,
 *   400 `VALIDATION_ERROR`.
 * `reviewDeadline` is null until governance sets the no-decision deadline
 * after which the backend fails open (AD-14; duration not decided yet).
 */

export const qualityReasonSchema = z.object({
  /** Signal code shown as-is (FAST_COMPLETION, ATTENTION_CHECK_FAILED, STRAIGHT_LINING…). */
  code: z.string().min(1),
  /** Numbers the Vietnamese explanation needs (durations in seconds, question numbers…). */
  params: z.record(z.string(), z.number()),
});
export type QualityReason = z.infer<typeof qualityReasonSchema>;

export const qualityConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type QualityConfidence = z.infer<typeof qualityConfidenceSchema>;

export const qualityReviewSchema = z.object({
  responseId: z.string().uuid(),
  attemptId: z.string().uuid(),
  /** Short public reference ("9A2E"). */
  reference: z.string().min(1),
  surveyId: z.string().uuid(),
  surveyTitle: z.string().min(1),
  formVersionNumber: z.number().int().positive(),
  submittedAt: z.string().datetime(),
  heldPoints: z.number().int().positive(),
  reviewDeadline: z.string().datetime().nullable(),
  /** 0–100 quality score of the answer. */
  qualityScore: z.number().int().min(0).max(100),
  confidence: qualityConfidenceSchema,
  /** Share of the signals that had data (0–1). */
  coverage: z.number().min(0).max(1),
  policyVersion: z.string().min(1),
  reasons: z.array(qualityReasonSchema),
  respondent: z.object({
    reliabilityLevel: z.enum(["FORMING", "GOOD", "REVIEW"]),
    /** Earlier assessed in-Rescom answers of this respondent, and how many passed. */
    priorAssessed: z.number().int().nonnegative(),
    priorPassed: z.number().int().nonnegative(),
  }),
  surveyQuality: z.object({
    version: z.number().int().positive(),
    status: z.enum(["INSUFFICIENT_DATA", "READY"]),
  }),
  answers: z.array(z.object({ question: z.string().min(1), answer: z.string() })),
});
export type QualityReview = z.infer<typeof qualityReviewSchema>;

export const qualityReviewListSchema = z.object({
  items: z.array(qualityReviewSchema),
  total: z.number().int().nonnegative(),
});
export type QualityReviewList = z.infer<typeof qualityReviewListSchema>;

export const qualityDecisionSchema = z.enum(["ACCEPT", "INSUFFICIENT_EVIDENCE", "REJECT"]);
export type QualityDecision = z.infer<typeof qualityDecisionSchema>;

export const QUALITY_NOTE_MAX_LENGTH = 500;

/** Body of the decision route; a rejection needs a reason. */
export const qualityDecisionCommandSchema = z
  .object({
    decision: qualityDecisionSchema,
    note: z.string().trim().max(QUALITY_NOTE_MAX_LENGTH),
  })
  .strict()
  .refine((command) => command.decision !== "REJECT" || command.note.length > 0, {
    message: "A rejection needs a reason",
    path: ["note"],
  });
export type QualityDecisionCommand = z.infer<typeof qualityDecisionCommandSchema>;

export const qualityDecisionResultSchema = z.object({
  responseId: z.string().uuid(),
  decision: qualityDecisionSchema,
  outcome: z.enum(["RELEASED", "REVERSED"]),
  points: z.number().int().nonnegative(),
  decidedAt: z.string().datetime(),
});
export type QualityDecisionResult = z.infer<typeof qualityDecisionResultSchema>;

export function listQualityReviews(signal?: AbortSignal): Promise<QualityReviewList> {
  return apiRequest("/admin/quality-reviews", { schema: qualityReviewListSchema, signal });
}

export function decideQualityReview(
  responseId: string,
  command: QualityDecisionCommand,
  signal?: AbortSignal,
): Promise<QualityDecisionResult> {
  return apiRequest(`/admin/quality-reviews/${encodeURIComponent(responseId)}/decision`, {
    method: "POST",
    body: command,
    schema: qualityDecisionResultSchema,
    signal,
  });
}
