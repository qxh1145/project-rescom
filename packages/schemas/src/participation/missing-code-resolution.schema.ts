import { z } from "zod";
import { attemptStatusSchema } from "./survey-runner.schema";

/**
 * Story 14.1 · Missing-Code Report Resolution contracts (AC 1, 3, 5, 6, 7).
 */

export const MISSING_CODE_RESOLUTION_OUTCOMES = [
  "CREDIT_RESPONDENT",
  "DISMISSED",
] as const;

export const missingCodeResolutionOutcomeSchema = z.enum(
  MISSING_CODE_RESOLUTION_OUTCOMES,
);
export type MissingCodeResolutionOutcome = z.infer<
  typeof missingCodeResolutionOutcomeSchema
>;

export const MISSING_CODE_RESOLUTION_NOTE_MIN = 10;
export const MISSING_CODE_RESOLUTION_NOTE_MAX = 500;

export const resolveMissingCodeReportSchema = z
  .object({
    outcome: missingCodeResolutionOutcomeSchema,
    note: z
      .string()
      .trim()
      .min(
        MISSING_CODE_RESOLUTION_NOTE_MIN,
        `note must be at least ${MISSING_CODE_RESOLUTION_NOTE_MIN} characters`,
      )
      .max(
        MISSING_CODE_RESOLUTION_NOTE_MAX,
        `note must be at most ${MISSING_CODE_RESOLUTION_NOTE_MAX} characters`,
      ),
  })
  .strict();
export type ResolveMissingCodeReportInput = z.infer<
  typeof resolveMissingCodeReportSchema
>;

export const resolveMissingCodeReportResultSchema = z
  .object({
    attemptId: z.string().uuid(),
    outcome: missingCodeResolutionOutcomeSchema,
    attemptStatus: attemptStatusSchema,
    rewardPoints: z.number().int().nonnegative().nullable(),
    replayed: z.boolean(),
  })
  .strict();
export type ResolveMissingCodeReportResult = z.infer<
  typeof resolveMissingCodeReportResultSchema
>;

export const missingCodeAuditKey = (id: string): string =>
  `admin-audit:missing-code:${id}`;
export const missingCodeResolvedEventKey = (id: string): string =>
  `missing-code-resolved:${id}`;

export const MISSING_CODE_AUDIT_EVENT_TYPE = "AdminMissingCodeReportResolved";

export const missingCodeAuditEventPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal("MISSING_CODE_REPORT_RESOLVED"),
    auditCategory: z.literal("MODERATION_ADMIN_ACTION"),
    adminId: z.string().uuid(),
    attemptId: z.string().uuid(),
    surveyId: z.string().min(1),
    outcome: missingCodeResolutionOutcomeSchema,
    rewardPoints: z.number().int().nonnegative().nullable(),
    journalId: z.string().uuid().nullable(),
    noteLength: z.number().int().nonnegative(),
    correlationId: z.string().nullable(),
    occurredAt: z.string().datetime(),
  })
  .strict();
export type MissingCodeAuditEventPayload = z.infer<
  typeof missingCodeAuditEventPayloadSchema
>;

export const MISSING_CODE_RESOLVED_EVENT_TYPE =
  "ParticipationMissingCodeReportResolved";

export const missingCodeResolvedEventPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    attemptId: z.string().uuid(),
    surveyId: z.string().min(1),
    surveyTitle: z.string(),
    respondentId: z.string().uuid().nullable(),
    publisherId: z.string().uuid(),
    outcome: missingCodeResolutionOutcomeSchema,
    rewardPoints: z.number().int().nonnegative().nullable(),
    note: z.string().min(1),
    occurredAt: z.string().datetime(),
  })
  .strict();
export type MissingCodeResolvedEventPayload = z.infer<
  typeof missingCodeResolvedEventPayloadSchema
>;
