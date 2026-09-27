import { z } from "zod";
import { emailSchema, loginPasswordSchema } from "./credentials.schema";

export const loginSchema = z
  .object({
    email: emailSchema,
    password: loginPasswordSchema,
  })
  .strict();

export type LoginDto = z.infer<typeof loginSchema>;
