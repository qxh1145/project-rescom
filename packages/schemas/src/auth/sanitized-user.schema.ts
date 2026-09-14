import { z } from 'zod';

export const sanitizedUserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(['ADMIN', 'PUBLISHER', 'RESPONDENT']),
    status: z.enum(['ACTIVE', 'LOCKED']),
  })
  .strict();

export type SanitizedUser = z.infer<typeof sanitizedUserSchema>;
