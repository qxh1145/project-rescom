import { z } from "zod";
import { respondentFormBlockSchema } from "./form-blocks.schema";
import {
  formSectionSchema,
  formSettingsSchema,
} from "./form-definition.schema";
import { formIntegrityMetadataSchema } from "./form-integrity.schema";

/**
 * Public Form Details Schema
 * Projected representation of a published internal form accessible to unauthenticated guests.
 * Blocks are the Respondent projection: no `integrity` (review MEDIUM-1).
 */
export const publicFormDetailsSchema = z
  .object({
    id: z.string().uuid("Form ID must be a valid UUID"),
    title: z.string().min(1, "Form title is required").max(200),
    description: z.string().nullable().optional(),
    type: z.literal("INTERNAL"),
    versionNumber: z.number().int().positive(),
    blocks: z.array(respondentFormBlockSchema).min(1),
    sections: z.array(formSectionSchema).max(50).optional(),
    settings: formSettingsSchema,
    metadata: formIntegrityMetadataSchema,
    publicUrl: z.string().min(1),
    publishedAt: z.string().nullable().optional(),
  })
  .strict();

export type PublicFormDetailsDto = z.infer<typeof publicFormDetailsSchema>;

/**
 * Guest Submission Input Schema
 */
export const guestSubmissionSchema = z
  .object({
    answers: z.record(z.unknown()),
    captchaToken: z
      .string()
      .trim()
      .min(1, "Captcha verification token is required"),
    telemetry: z.record(z.unknown()).optional(),
  })
  .strict();

export type GuestSubmissionInput = z.infer<typeof guestSubmissionSchema>;

/**
 * Guest Submission Response Schema
 */
export const guestSubmissionResponseSchema = z
  .object({
    submissionId: z.string().uuid(),
    formId: z.string().uuid(),
    status: z.literal("SUBMITTED"),
    isGuest: z.literal(true),
    rewardEarned: z.literal(0),
    integrityStatus: z.enum(["ASSESSED", "PENDING"]).default("ASSESSED"),
    respondentReliability: z.literal("NOT_AVAILABLE"),
    submittedAt: z.string(),
  })
  .strict();

export type GuestSubmissionResponseDto = z.infer<
  typeof guestSubmissionResponseSchema
>;
