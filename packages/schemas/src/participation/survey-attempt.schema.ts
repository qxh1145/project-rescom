import { z } from 'zod';
import { attemptTimeBarrierSchema } from './bot-protection';

/**
 * Story 5.1 AC3.1: an attempt reserves a quota slot for this long after its
 * server-recorded start. Shared by Participation (quota, submit, verify) and
 * Storage (write access to an attempt's uploads) — Epic 5 review P16.
 */
export const RESERVATION_EXPIRY_MINUTES = 30;
export const RESERVATION_EXPIRY_MS = RESERVATION_EXPIRY_MINUTES * 60 * 1000;

/**
 * Decision E4-DN2 (option A): a Publisher never takes their own survey — the
 * Marketplace feed hides it and starting an attempt is refused with 403 and
 * this code (same four-eyes rule as moderation and top-up approval).
 */
export const SELF_PARTICIPATION_FORBIDDEN_CODE = 'SELF_PARTICIPATION_FORBIDDEN';

/** Epic 5 review P2: bounds of the opaque, client-supplied `clientContext`. */
export const CLIENT_CONTEXT_MAX_KEYS = 20;
export const CLIENT_CONTEXT_MAX_BYTES = 2048;

/**
 * Opaque, client-supplied diagnostics (device, locale, …). Flat, bounded and
 * never read by server logic: security counters (completion-code strikes,
 * missing-code reports) live in server-owned columns (Epic 5 review P2).
 */
export const clientContextSchema = z
  .record(
    z.string().max(64),
    z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]),
  )
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > CLIENT_CONTEXT_MAX_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `clientContext must not have more than ${CLIENT_CONTEXT_MAX_KEYS} keys.`,
      });
      return;
    }
    if (JSON.stringify(value).length > CLIENT_CONTEXT_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `clientContext must not exceed ${CLIENT_CONTEXT_MAX_BYTES} bytes.`,
      });
    }
  });

export type ClientContext = z.infer<typeof clientContextSchema>;

/**
 * Input schema for initiating a survey attempt.
 * POST /api/forms/:id/attempts
 */
export const startSurveyAttemptInputSchema = z.object({
  clientContext: clientContextSchema.optional(),
});

export type StartSurveyAttemptInput = z.infer<
  typeof startSurveyAttemptInputSchema
>;

/**
 * Output DTO schema for a created survey attempt.
 * Pinned to immutable FormVersion; includes pre-created IN_PROGRESS Response identity for INTERNAL.
 * A new attempt is always IN_PROGRESS (Epic 5 review P27).
 */
export const surveyAttemptResponseSchema = z.object({
  attemptId: z.string().uuid(),
  responseId: z.string().uuid().nullable(),
  formId: z.string().uuid(),
  formVersionId: z.string().uuid(),
  type: z.enum(['INTERNAL', 'EXTERNAL']),
  status: z.literal('IN_PROGRESS'),
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  externalUrl: z.string().url().nullable().optional(),
  storageCapability: z.string().min(32),
  /** Story 8.2: minimum time before the attempt may be submitted (server-authoritative). */
  timeBarrier: attemptTimeBarrierSchema.optional(),
});

export type SurveyAttemptResponseDto = z.infer<
  typeof surveyAttemptResponseSchema
>;

/**
 * Epic 5 review P24: `details` of a 409 CONFLICTING_ACTIVE_ATTEMPT — the
 * caller's own unexpired attempt, so a client that lost its tab can resume.
 */
export const conflictingActiveAttemptDetailsSchema = z.object({
  attemptId: z.string().uuid(),
  responseId: z.string().uuid().nullable(),
  formVersionId: z.string().uuid(),
  type: z.enum(['INTERNAL', 'EXTERNAL']),
  expiresAt: z.string().datetime(),
});

export type ConflictingActiveAttemptDetails = z.infer<
  typeof conflictingActiveAttemptDetailsSchema
>;
