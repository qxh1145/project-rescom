import { z } from "zod";

/**
 * IR.1: `GET /auth/csrf` and `POST /auth/refresh` both answer
 * `{ data: { csrfToken } }`; this is the `data` part.
 */
export const csrfTokenResponseSchema = z
  .object({ csrfToken: z.string().min(1) })
  .passthrough();
export type CsrfTokenResponse = z.infer<typeof csrfTokenResponseSchema>;
