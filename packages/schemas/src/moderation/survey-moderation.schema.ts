import { z } from "zod";
import { formStatusEnum, formTypeEnum } from "../forms/form-draft.schema";
import { surveyTargetingSchema } from "../forms/form-targeting.schema";

/**
 * Survey moderation contracts (Story 8.1, FR-20, FR-53, AD-16).
 *
 * Every published survey waits in `MODERATION_QUEUE` until an Admin approves it
 * (→ `PUBLISHED`, visible in the Marketplace) or rejects it with a reason
 * (→ `CLOSED`, reserved Escrow refunded). The Admin always decides on the exact
 * FormVersion they previewed (AD-19).
 */

export const MODERATION_QUEUE_DEFAULT_LIMIT = 20;
export const MODERATION_QUEUE_MAX_LIMIT = 50;
/**
 * Upper bound of the queue `offset` (Epic 8 review P7): an unbounded value
 * (e.g. `1e20`) would reach the database `skip` and fail with a 500.
 */
export const MODERATION_QUEUE_MAX_OFFSET = 10_000;
export const MODERATION_REJECTION_REASON_MIN_LENGTH = 5;
export const MODERATION_REJECTION_REASON_MAX_LENGTH = 500;
export const MODERATION_APPROVAL_NOTE_MAX_LENGTH = 500;

/**
 * Stable identity of one moderation decision: Unit of Work key and
 * notification dedupe key. One decision exists per FormVersion.
 */
export function surveyModerationKey(formVersionId: string): string {
  return `moderation:${formVersionId}`;
}

/** Must stay identical to the Prisma `SurveyModerationOutcome` enum. */
export const surveyModerationOutcomeSchema = z.enum(["APPROVED", "REJECTED"]);
export type SurveyModerationOutcome = z.infer<typeof surveyModerationOutcomeSchema>;

/** Query-string tolerant list parameters for `GET /admin/moderation/surveys`. */
export const listModerationQueueQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(
        MODERATION_QUEUE_MAX_LIMIT,
        `limit must be at most ${MODERATION_QUEUE_MAX_LIMIT}`,
      )
      .default(MODERATION_QUEUE_DEFAULT_LIMIT),
    offset: z.coerce
      .number()
      .int("offset must be an integer")
      .min(0, "offset cannot be negative")
      .max(
        MODERATION_QUEUE_MAX_OFFSET,
        `offset must be at most ${MODERATION_QUEUE_MAX_OFFSET}`,
      )
      .default(0),
  })
  .strict();
export type ListModerationQueueQuery = z.infer<typeof listModerationQueueQuerySchema>;

/** One survey as shown in the Admin moderation queue. */
export const moderationQueueItemSchema = z.object({
  formId: z.string().uuid(),
  formVersionId: z.string().uuid(),
  versionNumber: z.number().int().min(1),
  title: z.string(),
  description: z.string().nullable(),
  type: formTypeEnum,
  status: formStatusEnum,
  publisherId: z.string().uuid(),
  publisherEmail: z.string().nullable(),
  rewardPerResponse: z.number().int().min(0),
  expectedCompletions: z.number().int().min(0),
  /** Reward per completion after the Internal Form discount (FR-19). */
  effectiveRewardPerResponse: z.number().int().min(0),
  /**
   * Escrow cost quote of the submission (expected completions × effective
   * reward). A quote, not what the ledger holds: a re-publication reserves only
   * its shortfall and a legacy row may hold nothing — the preview reports the
   * held amount (`escrowHeld`, `fundingShortfall`).
   */
  escrowAmount: z.number().int().min(0),
  estimatedEffortSeconds: z.number().int().min(0),
  blocksCount: z.number().int().min(0),
  externalUrl: z.string().nullable(),
  /**
   * The stored targeting criteria, or `null` when the survey has none — or
   * when the stored value is invalid (then `targetingInvalid` is true).
   */
  targetingJson: surveyTargetingSchema.nullable(),
  /**
   * True when the stored targeting fails validation (legacy/corrupt row,
   * Epic 8 review P6). Approval of such a survey is refused.
   */
  targetingInvalid: z.boolean().default(false),
  /** True when an earlier version of this survey was already live. */
  isResubmission: z.boolean(),
  /** When the survey entered the moderation queue. */
  submittedAt: z.string().datetime(),
});
export type ModerationQueueItemDto = z.infer<typeof moderationQueueItemSchema>;

export const moderationQueueListSchema = z.object({
  items: z.array(moderationQueueItemSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type ModerationQueueListDto = z.infer<typeof moderationQueueListSchema>;

export const surveyModerationDecisionSchema = z.object({
  id: z.string().uuid(),
  formId: z.string().uuid(),
  formVersionId: z.string().uuid(),
  versionNumber: z.number().int().min(1),
  outcome: surveyModerationOutcomeSchema,
  adminId: z.string().uuid(),
  reason: z.string().nullable(),
  refundAmount: z.number().int().min(0),
  refundJournalId: z.string().uuid().nullable(),
  correlationId: z.string().uuid(),
  decidedAt: z.string().datetime(),
});
export type SurveyModerationDecisionDto = z.infer<typeof surveyModerationDecisionSchema>;

/**
 * Admin preview: the queue item plus the pinned version's Form Definition
 * (rendered read-only by the dashboard) and the latest decision, if any.
 */
export const moderationSurveyPreviewSchema = moderationQueueItemSchema.extend({
  schemaJson: z.unknown(),
  decision: surveyModerationDecisionSchema.nullable(),
  /**
   * Escrow the survey actually holds in the ledger (from its own journals,
   * Epic 6 review P4). `null` when the survey is no longer awaiting moderation.
   */
  escrowHeld: z.number().int().min(0).nullable(),
  /**
   * Points still missing to fund the open quota (Epic 8 review P2). Approval
   * is refused with `409 MODERATION_ESCROW_NOT_FUNDED` while it is above 0.
   * `null` when the survey is no longer awaiting moderation.
   */
  fundingShortfall: z.number().int().min(0).nullable(),
});
export type ModerationSurveyPreviewDto = z.infer<typeof moderationSurveyPreviewSchema>;

export const approveSurveyModerationSchema = z
  .object({
    formVersionId: z.string().uuid("formVersionId must be a valid UUID"),
    note: z
      .string()
      .trim()
      .max(
        MODERATION_APPROVAL_NOTE_MAX_LENGTH,
        `Note must be at most ${MODERATION_APPROVAL_NOTE_MAX_LENGTH} characters`,
      )
      .optional(),
  })
  .strict();
export type ApproveSurveyModerationInput = z.infer<typeof approveSurveyModerationSchema>;

export const rejectSurveyModerationSchema = z
  .object({
    formVersionId: z.string().uuid("formVersionId must be a valid UUID"),
    reason: z
      .string({ required_error: "A rejection reason is required" })
      .trim()
      .min(
        MODERATION_REJECTION_REASON_MIN_LENGTH,
        `Rejection reason must be at least ${MODERATION_REJECTION_REASON_MIN_LENGTH} characters`,
      )
      .max(
        MODERATION_REJECTION_REASON_MAX_LENGTH,
        `Rejection reason must be at most ${MODERATION_REJECTION_REASON_MAX_LENGTH} characters`,
      ),
  })
  .strict();
export type RejectSurveyModerationInput = z.infer<typeof rejectSurveyModerationSchema>;

export const surveyModerationResultSchema = z.object({
  decision: surveyModerationDecisionSchema,
  form: z.object({
    id: z.string().uuid(),
    status: formStatusEnum,
    currentVersionId: z.string().uuid(),
    isPublished: z.boolean(),
    publishedAt: z.string().datetime().nullable(),
  }),
  /** True when the decision already existed and this call returned it unchanged. */
  replayed: z.boolean(),
});
export type SurveyModerationResultDto = z.infer<typeof surveyModerationResultSchema>;

/** Approval refused because the queued survey's Escrow is not fully reserved. */
export const MODERATION_ESCROW_NOT_FUNDED_CODE = "MODERATION_ESCROW_NOT_FUNDED";

export const SURVEY_MODERATION_AUDIT_EVENT_TYPES = {
  APPROVED: "AdminSurveyApproved",
  REJECTED: "AdminSurveyRejected",
} as const;

/**
 * Replayable Moderation admin-audit event appended to the Outbox in the same
 * transaction as the decision (AD-16, mirrors `AdminTopUpApproved`).
 */
export const surveyModerationAuditEventPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  auditCategory: z.literal("MODERATION_ADMIN_ACTION"),
  action: z.enum(["SURVEY_APPROVED", "SURVEY_REJECTED"]),
  decisionId: z.string().uuid(),
  formId: z.string().uuid(),
  formVersionId: z.string().uuid(),
  versionNumber: z.number().int().min(1),
  publisherId: z.string().uuid(),
  adminId: z.string().uuid(),
  reason: z.string().nullable(),
  refundAmount: z.number().int().min(0),
  refundJournalId: z.string().uuid().nullable(),
  ledgerIdempotencyKey: z.string().nullable(),
  correlationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});
export type SurveyModerationAuditEventPayload = z.infer<
  typeof surveyModerationAuditEventPayloadSchema
>;
