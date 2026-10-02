import { z } from "zod";
import { attemptStatusSchema } from "../participation/survey-runner.schema";
import { keysetCursorSchema } from "./keyset-cursor";

/**
 * Admin · open missing-completion-code reports (FR-23), read only.
 *
 * `GET /admin/missing-code-reports?limit&cursor`: the same unresolved set the
 * overview counts (`openIssues.missingCodeReports`), newest report first (ties
 * by attempt id descending). `cursor` = `nextCursor` of the previous page,
 * `<reportedAt>:<attemptId>`.
 */

export const MISSING_CODE_REPORT_MAX_LIMIT = 100;
export const MISSING_CODE_REPORT_DEFAULT_LIMIT = 50;

export const listMissingCodeReportsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MISSING_CODE_REPORT_MAX_LIMIT)
      .default(MISSING_CODE_REPORT_DEFAULT_LIMIT),
    cursor: keysetCursorSchema.optional(),
  })
  .strict();
export type ListMissingCodeReportsQuery = z.infer<typeof listMissingCodeReportsQuerySchema>;

export const missingCodeReportSchema = z
  .object({
    attemptId: z.string().uuid(),
    survey: z.object({ id: z.string().min(1), title: z.string() }).strict().nullable(),
    respondent: z
      .object({ id: z.string().uuid(), displayName: z.string().nullable() })
      .strict()
      .nullable(),
    reason: z.string().nullable(),
    reportedAt: z.string().datetime(),
    attemptStatus: attemptStatusSchema,
  })
  .strict();
export type MissingCodeReport = z.infer<typeof missingCodeReportSchema>;

export const missingCodeReportPageSchema = z
  .object({
    items: z.array(missingCodeReportSchema).max(MISSING_CODE_REPORT_MAX_LIMIT),
    /** All unresolved reports (every page). */
    total: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type MissingCodeReportPage = z.infer<typeof missingCodeReportPageSchema>;
