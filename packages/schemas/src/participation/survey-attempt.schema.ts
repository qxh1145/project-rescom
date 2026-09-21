import { z } from 'zod';

/**
 * Input schema for initiating a survey attempt.
 * POST /api/forms/:id/attempts
 */
export const startSurveyAttemptInputSchema = z.object({
  clientContext: z.record(z.unknown()).optional(),
});

export type StartSurveyAttemptInput = z.infer<
  typeof startSurveyAttemptInputSchema
>;

/**
 * Output DTO schema for a created survey attempt.
 * Pinned to immutable FormVersion; includes pre-created IN_PROGRESS Response identity for INTERNAL.
 */
export const surveyAttemptResponseSchema = z.object({
  attemptId: z.string().uuid(),
  responseId: z.string().uuid().nullable(),
  formId: z.string().uuid(),
  formVersionId: z.string().uuid(),
  type: z.enum(['INTERNAL', 'EXTERNAL']),
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'LOCKED']),
  startedAt: z.string(),
  expiresAt: z.string(),
  externalUrl: z.string().url().nullable().optional(),
  storageCapability: z.string().min(32),
});

export type SurveyAttemptResponseDto = z.infer<
  typeof surveyAttemptResponseSchema
>;
