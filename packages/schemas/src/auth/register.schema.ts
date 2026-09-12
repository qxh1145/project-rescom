import { z } from 'zod';
import { emailSchema, registerPasswordSchema } from './credentials.schema';

export const registerSchema = z
  .object({
    email: emailSchema,
    password: registerPasswordSchema,
  })
  .strict();

export type RegisterDto = z.infer<typeof registerSchema>;
