import { z } from "zod";
import {
  MODERATION_QUEUE_MAX_LIMIT,
  moderationQueueItemSchema,
  surveyModerationDecisionSchema,
  surveyModerationResultSchema,
  surveyTargetingSchema,
  type SurveyModerationResultDto,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Admin "Duyệt khảo sát" (Figma 11a 62:3406, 11a' 62:2868).
 *
 * VERIFIED (`apps/backend/src/modules/moderation/presentation/admin-moderation.controller.ts`
 * + `packages/schemas/src/moderation`):
 * - `GET  /admin/moderation/surveys?limit&offset` — queue, oldest submission first
 * - `GET  /admin/moderation/surveys/:formId` — preview (+ escrow held, shortfall, decision)
 * - `POST /admin/moderation/surveys/:formId/approve` `{ formVersionId, note? }` → PUBLISHED
 * - `POST /admin/moderation/surveys/:formId/reject` `{ formVersionId, reason }` → CLOSED,
 *   escrow refunded, SURVEY_REJECTED notification to the publisher
 *
 * ASSUMED API CONTRACT extensions (optional, so the real backend still parses):
 * - `publisherName` — Figma "Người đăng: Linh N." (the DTO only has the email)
 * - `publisherFraudLogCount` — Figma "0 vi phạm FraudLog"
 * - (`deadlineAt` and `topic` are VERIFIED since IR.2b / plan 2.2)
 * - `targetingJson.schools` — same extension as the Google Forms wizard
 */

const targetingSchema = surveyTargetingSchema.extend({
  schools: z.array(z.string()).optional(),
});
export type ModerationTargeting = z.infer<typeof targetingSchema>;

const extensions = {
  targetingJson: targetingSchema.nullable(),
  publisherName: z.string().nullable().optional(),
  publisherFraudLogCount: z.number().int().min(0).nullable().optional(),
};

export const moderationQueueEntrySchema = moderationQueueItemSchema.extend(extensions);
export type ModerationQueueEntry = z.infer<typeof moderationQueueEntrySchema>;

export const moderationQueuePageSchema = z.object({
  items: z.array(moderationQueueEntrySchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type ModerationQueuePage = z.infer<typeof moderationQueuePageSchema>;

/** `moderationSurveyPreviewSchema` + the extensions above. */
export const moderationPreviewSchema = moderationQueueEntrySchema.extend({
  schemaJson: z.unknown(),
  decision: surveyModerationDecisionSchema.nullable(),
  escrowHeld: z.number().int().min(0).nullable(),
  fundingShortfall: z.number().int().min(0).nullable(),
});
export type ModerationPreview = z.infer<typeof moderationPreviewSchema>;

export type ModerationResult = SurveyModerationResultDto;

/** One page is enough for the console (backend max 50, the Figma queue shows 3). */
export const MODERATION_PAGE_SIZE = MODERATION_QUEUE_MAX_LIMIT;

const surveyPath = (formId: string) => `/admin/moderation/surveys/${encodeURIComponent(formId)}` as const;

export function listModerationQueue(
  query: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<ModerationQueuePage> {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit ?? MODERATION_PAGE_SIZE));
  if (query.offset) params.set("offset", String(query.offset));
  return apiRequest(`/admin/moderation/surveys?${params.toString()}`, { schema: moderationQueuePageSchema, signal });
}

export function getModerationSurvey(formId: string, signal?: AbortSignal): Promise<ModerationPreview> {
  return apiRequest(surveyPath(formId), { schema: moderationPreviewSchema, signal });
}

/** Idempotent for the same version (a replay returns `replayed: true`). */
export function approveModerationSurvey(formId: string, formVersionId: string): Promise<ModerationResult> {
  return apiRequest(`${surveyPath(formId)}/approve`, {
    method: "POST",
    body: { formVersionId },
    schema: surveyModerationResultSchema,
  });
}

/** `reason` (5–500 chars) is sent to the publisher; the escrow is refunded. */
export function rejectModerationSurvey(
  formId: string,
  input: { formVersionId: string; reason: string },
): Promise<ModerationResult> {
  return apiRequest(`${surveyPath(formId)}/reject`, {
    method: "POST",
    body: { formVersionId: input.formVersionId, reason: input.reason },
    schema: surveyModerationResultSchema,
  });
}
