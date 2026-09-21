import { z } from "zod";
import { surveyTargetingSchema } from "./form-targeting.schema";
import type { FormDetailDto } from "./form-draft.schema";

/**
 * Validates whether a URL belongs to Google Forms.
 */
export function isGoogleFormsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "docs.google.com" ||
      host === "forms.google.com" ||
      host === "forms.gle"
    );
  } catch {
    return false;
  }
}

/**
 * Input schema for creating an external survey (e.g. Google Forms).
 */
export const createExternalSurveySchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(200, "Title cannot exceed 200 characters"),
    description: z.string().max(2000).optional().nullable(),
    externalUrl: z
      .string()
      .trim()
      .url("Invalid external survey URL")
      .refine(
        (url) => url.startsWith("https://"),
        "External survey URL must use HTTPS",
      ),
    rewardPerResponse: z
      .number()
      .int("Reward must be an integer")
      .min(0, "Reward cannot be negative")
      .max(10000, "Reward cannot exceed 10,000 points")
      .default(10),
    expectedCompletions: z
      .number()
      .int("Expected completions must be an integer")
      .min(1, "Expected completions must be at least 1")
      .max(100000, "Expected completions cannot exceed 100,000")
      .default(50),
    targetingJson: surveyTargetingSchema.optional().nullable(),
    autoPublish: z.boolean().default(false),
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
}

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
