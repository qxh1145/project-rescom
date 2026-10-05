import { z } from "zod";
import { keysetCursorSchema } from "./keyset-cursor";

/**
 * Story IR.2b Task 4.7 (AD-10 "audited re-drive", Q9): the Admin dead-letter
 * operations of the Outbox dispatcher. The list never carries the payload;
 * there is deliberately no "skip" (a money-stream skip needs a compensating
 * command).
 */
export const listOutboxDeadLettersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    /** `nextCursor` of the previous page (newest first). */
    cursor: keysetCursorSchema.optional(),
  })
  .strict();
export type ListOutboxDeadLettersQuery = z.infer<typeof listOutboxDeadLettersQuerySchema>;

export const outboxDeadLetterItemSchema = z
  .object({
    id: z.string().uuid(),
    eventType: z.string(),
    aggregateType: z.string(),
    aggregateId: z.string(),
    attempts: z.number().int().nonnegative(),
    terminalState: z.string().nullable(),
    lastError: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type OutboxDeadLetterItem = z.infer<typeof outboxDeadLetterItemSchema>;

export const outboxDeadLetterPageSchema = z
  .object({
    items: z.array(outboxDeadLetterItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type OutboxDeadLetterPage = z.infer<typeof outboxDeadLetterPageSchema>;

/** `POST /admin/outbox/events/:eventId/redrive` takes an empty body. */
export const redriveOutboxEventSchema = z.object({}).strict();

export const outboxRedriveResultSchema = z
  .object({
    eventId: z.string().uuid(),
    status: z.literal("PENDING"),
  })
  .strict();
export type OutboxRedriveResult = z.infer<typeof outboxRedriveResultSchema>;
