import { z } from 'zod';
import { sanitizedUserSchema } from './sanitized-user.schema';

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.any().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const authSuccessEnvelopeSchema = z.object({
  data: z.object({
    user: sanitizedUserSchema,
  }),
  error: z.null(),
  meta: z.record(z.unknown()).default({}),
});

export const apiErrorEnvelopeSchema = z.object({
  data: z.null(),
  error: apiErrorSchema,
  meta: z.record(z.unknown()).default({}),
});

export type AuthSuccessEnvelope = z.infer<typeof authSuccessEnvelopeSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
