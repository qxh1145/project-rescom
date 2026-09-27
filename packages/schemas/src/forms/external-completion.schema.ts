import { z } from 'zod';
import {
  rewardSettlementResultSchema,
  RewardSettlementResultDto,
} from '../economy/reward.schema';
import { clientContextSchema } from '../participation/survey-attempt.schema';

/**
 * Input schema for submitting an external survey completion code.
 */
export const verifyExternalCompletionCodeInputSchema = z
  .object({
    attemptId: z.string().uuid().optional(),
    completionCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Completion code must be exactly 6 numeric digits'),
    clientContext: clientContextSchema.optional(),
  })
  .strict();

export type VerifyExternalCompletionCodeInput = z.infer<
  typeof verifyExternalCompletionCodeInputSchema
>;

/**
 * Response schema returned upon successful verification of an external completion code.
 */
export const verifyExternalCompletionCodeResponseSchema = z
  .object({
    attemptId: z.string().uuid(),
    formId: z.string().uuid(),
    formVersionId: z.string().uuid(),
    status: z.literal('COMPLETED'),
    completedAt: z.string().datetime(),
    reward: rewardSettlementResultSchema,
    message: z.string(),
  })
  .strict();

export type VerifyExternalCompletionCodeResponseDto = z.infer<
  typeof verifyExternalCompletionCodeResponseSchema
>;

/**
 * Input schema for reporting a missing completion code (FR-23).
 */
export const reportMissingCompletionCodeInputSchema = z
  .object({
    attemptId: z.string().uuid().optional(),
    reason: z
      .string()
      .trim()
      .min(5, 'Reason must be at least 5 characters')
      .max(1000, 'Reason cannot exceed 1000 characters'),
    clientContext: clientContextSchema.optional(),
  })
  .strict();

export type ReportMissingCompletionCodeInput = z.infer<
  typeof reportMissingCompletionCodeInputSchema
>;

/**
 * Response schema returned after submitting a missing code report.
 */
export const reportMissingCompletionCodeResponseSchema = z
  .object({
    attemptId: z.string().uuid(),
    reportedAt: z.string().datetime(),
    status: z.literal('REPORTED'),
    message: z.string(),
  })
  .strict();

export type ReportMissingCompletionCodeResponseDto = z.infer<
  typeof reportMissingCompletionCodeResponseSchema
>;
