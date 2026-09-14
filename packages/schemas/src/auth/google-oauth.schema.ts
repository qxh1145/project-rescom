import { z } from "zod";
import { loginPasswordSchema } from "./credentials.schema";

const nonArrayString = (maxLen: number, minLen = 0) =>
  z.preprocess(
    (val) => (Array.isArray(val) ? "__ARRAY_INVALID__" : val),
    z
      .string()
      .min(minLen)
      .max(maxLen)
      .refine((val) => val !== "__ARRAY_INVALID__", {
        message: "Duplicate or array query parameters are rejected",
      }),
  );

export const googleCallbackQuerySchema = z
  .object({
    state: nonArrayString(2048, 1),
    code: nonArrayString(2048, 1).optional(),
    error: nonArrayString(255, 1).optional(),
    error_description: nonArrayString(2048).optional(),
    scope: nonArrayString(2048).optional(),
    iss: nonArrayString(2048).optional(),
  })
  .passthrough() // Safely ignore other non-critical provider extras as required by OpenID Connect
  .refine(
    (data) => {
      const hasCode = typeof data.code === "string" && data.code.length > 0;
      const hasError = typeof data.error === "string" && data.error.length > 0;
      return (hasCode && !hasError) || (!hasCode && hasError);
    },
    {
      message: "Callback query must provide exactly one of code or error",
      path: ["code"],
    },
  );

export type GoogleCallbackQuery = z.infer<typeof googleCallbackQuerySchema>;

export const googleLinkStartSchema = z
  .object({
    currentPassword: loginPasswordSchema,
  })
  .strict();

export type GoogleLinkStartDto = z.infer<typeof googleLinkStartSchema>;

export const googleLinkDeleteSchema = z
  .object({
    currentPassword: loginPasswordSchema,
  })
  .strict();

export type GoogleLinkDeleteDto = z.infer<typeof googleLinkDeleteSchema>;
