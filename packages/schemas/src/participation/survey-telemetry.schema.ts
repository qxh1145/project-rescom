import { z } from 'zod';

/**
 * Permitted behavioral telemetry event types matching Prisma IntegrityEventType.
 * Strictly non-invasive, privacy-preserving events (FR-58).
 */
export const integrityEventTypeEnum = z.enum([
  'SURVEY_ATTEMPT_STARTED',
  'SURVEY_ATTEMPT_RESUMED',
  'SURVEY_ATTEMPT_ABANDONED',
  'SURVEY_SUBMITTED',
  'QUESTION_SHOWN',
  'QUESTION_FOCUSED',
  'QUESTION_BLURRED',
  'ANSWER_SELECTED',
  'ANSWER_ENTERED',
  'ANSWER_CHANGED',
  'ANSWER_CLEARED',
  'QUESTION_SKIPPED',
  'QUESTION_RETURNED',
  'PAGE_HIDDEN',
  'PAGE_VISIBLE',
  'ATTENTION_CHECK_PASSED',
  'ATTENTION_CHECK_FAILED',
  'TIME_BARRIER_TRIGGERED',
]);

export type IntegrityEventType = z.infer<typeof integrityEventTypeEnum>;

const FORBIDDEN_METADATA_KEYS = [
  'keystroke',
  'keystrokes',
  'clipboard',
  'clipboardtext',
  'clipboard_text',
  'keypress',
  'key_press',
  'rawinput',
  'raw_input',
  'cookie',
  'cookies',
  'password',
  'token',
];

/**
 * Privacy-preserving telemetry metadata schema.
 * Rejects keystroke logging, clipboard content, sensitive credentials, and oversized payloads.
 */
export const telemetryMetadataSchema = z
  .record(z.unknown())
  .superRefine((val, ctx) => {
    for (const key of Object.keys(val)) {
      const lowerKey = key.toLowerCase();
      for (const forbidden of FORBIDDEN_METADATA_KEYS) {
        if (lowerKey.includes(forbidden)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Prohibited telemetry metadata key "${key}" violates privacy guardrails (FR-58).`,
            path: [key],
          });
          return;
        }
      }
    }

    try {
      const serialized = JSON.stringify(val);
      if (serialized && serialized.length > 2048) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Telemetry metadata must not exceed 2KB.',
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Telemetry metadata must be serializable JSON.',
      });
    }
  });

export type TelemetryMetadata = z.infer<typeof telemetryMetadataSchema>;

/**
 * Individual behavioral telemetry event contract (FR-58).
 */
export const telemetryEventItemSchema = z.object({
  clientEventId: z.string().uuid(),
  eventType: integrityEventTypeEnum,
  attemptId: z.string().uuid(),
  formVersionId: z.string().uuid(),
  responseId: z.string().uuid().nullable().optional(),
  questionId: z.string().min(1).max(100).optional(),
  sequence: z.number().int().nonnegative().optional(),
  occurredAt: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'occurredAt must be a valid ISO date-time string',
  }),
  metadata: telemetryMetadataSchema.optional(),
});

export type TelemetryEventItem = z.infer<typeof telemetryEventItemSchema>;

/**
 * Batch input schema for client telemetry ingestion.
 * POST /api/forms/:id/attempts/:attemptId/integrity-events
 * POST /api/responses/:responseId/integrity-events
 */
export const batchTelemetryEventsInputSchema = z.object({
  events: z.array(telemetryEventItemSchema).min(1, 'At least 1 event is required in a batch').max(100, 'Maximum 100 events per batch'),
  consentNoticeVersion: z.string().min(1).max(50).optional(),
});

export type BatchTelemetryEventsInput = z.infer<
  typeof batchTelemetryEventsInputSchema
>;

/**
 * Telemetry ingestion response DTO
 */
export const telemetryIngestionResponseSchema = z.object({
  success: z.boolean(),
  ingestedCount: z.number().int().nonnegative(),
  attemptId: z.string().uuid(),
});

export type TelemetryIngestionResponseDto = z.infer<
  typeof telemetryIngestionResponseSchema
>;
