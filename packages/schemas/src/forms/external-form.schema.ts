import { z } from "zod";
import { surveyTargetingSchema } from "./form-targeting.schema";
import { externalSurveyUrlSchema } from "./external-url.schema";
import { estimatedDurationMinutesSchema } from "../economy/pricing.schema";
import type { FormDetailDto } from "./form-draft.schema";
import { formDeadlineAtSchema, formTopicEnum } from "./form-topic.schema";

// `isGoogleFormsUrl` lives in `./external-url.schema` (decision E4-DN3: it is
// now the server-side allowlist enforced by `externalSurveyUrlSchema`).

/**
 * Input schema for creating an external survey (Google Forms only in Phase 1,
 * decision E4-DN3).
 */
export const createExternalSurveySchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(200, "Title cannot exceed 200 characters"),
    description: z.string().max(2000).optional().nullable(),
    externalUrl: externalSurveyUrlSchema,
    rewardPerResponse: z
      .number()
      .int("Reward must be an integer")
      .min(1, "Reward must be at least 1 point")
      .max(10000, "Reward cannot exceed 10,000 points")
      .default(10),
    expectedCompletions: z
      .number()
      .int("Expected completions must be an integer")
      .min(1, "Expected completions must be at least 1")
      .max(100000, "Expected completions cannot exceed 100,000")
      .default(50),
    /**
     * PRD FR-12 Step 1 "estimated completion time". Stored in
     * `metadata.expectedEffortSeconds` (same bounds as
     * `formIntegrityMetadataSchema`) so the Marketplace duration sort/filter
     * reflects the real survey length.
     */
    expectedEffortSeconds: z
      .number()
      .int("Estimated completion time must be a whole number of seconds")
      .min(10, "Estimated completion time must be at least 10 seconds")
      .max(86400, "Estimated completion time cannot exceed 24 hours")
      .default(60),
    /**
     * Estimated completion time in whole minutes (decision E6-D2): picks the
     * FR-14 pricing band enforced when the survey is published
     * (`autoPublish` or a later publish). The wizard sends the same estimate
     * as `expectedEffortSeconds`.
     */
    estimatedDurationMinutes: estimatedDurationMinutesSchema.optional(),
    targetingJson: surveyTargetingSchema.optional().nullable(),
    autoPublish: z.boolean().default(false),
    /** Plan 2.2: the wizard's "Chủ đề" (`FORM_TOPICS`). */
    topic: formTopicEnum.optional().nullable(),
    /**
     * Story IR.2b Q1: the wizard's "Hạn thu thập" as an instant (1 h – 180 d
     * ahead, checked by the server); null/omitted = no deadline.
     */
    deadlineAt: formDeadlineAtSchema.optional().nullable(),
  })
  .strict();

export type CreateExternalSurveyInput = z.input<typeof createExternalSurveySchema>;
export type CreateExternalSurveyDto = z.infer<typeof createExternalSurveySchema>;

/**
 * Schema for rotating a completion code on an external survey.
 * Rotating the code creates a new immutable FormVersion.
 */
export const rotateCompletionCodeSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500, "Reason cannot exceed 500 characters")
      .optional(),
  })
  .strict();

export type RotateCompletionCodeInput = z.input<typeof rotateCompletionCodeSchema>;
export type RotateCompletionCodeDto = z.infer<typeof rotateCompletionCodeSchema>;

/**
 * Response DTO returned exclusively upon creating or rotating an external survey.
 * Discloses `plaintextCompletionCode` exactly ONCE to the owning Publisher.
 */
export interface ExternalSurveyResponseDto extends FormDetailDto {
  plaintextCompletionCode: string;
  hasCompletionCode: true;
  externalUrl?: string | null;
  currentVersionNumber?: number;
  /**
   * `POST /forms/external` with an `Idempotency-Key` (Phase 5 C6): true when
   * this response replays the survey an earlier request with the same key
   * created (no second survey, no second Escrow lock).
   */
  idempotentReplay?: boolean;
}

/**
 * Phase 5 C6: request header that makes `POST /forms/external` idempotent per
 * Publisher. One key per survey the client means to create (e.g. a UUID kept
 * with the wizard draft); 8–128 characters of `A–Z a–z 0–9 . _ : -`.
 */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

export const idempotencyKeySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9._:-]{8,128}$/,
    "Idempotency-Key must be 8-128 characters of A-Z, a-z, 0-9, '.', '_', ':' or '-'",
  );

export const externalSurveyResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  type: z.literal("EXTERNAL"),
  plaintextCompletionCode: z
    .string()
    .regex(/^\d{6}$/, "Completion code must be exactly 6 numeric digits"),
  hasCompletionCode: z.literal(true),
  externalUrl: z.string().url(),
  currentVersionNumber: z.number().int().positive(),
  status: z.string(),
});
