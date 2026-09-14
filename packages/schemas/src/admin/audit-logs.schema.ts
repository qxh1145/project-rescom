import { z } from "zod";

export const auditOutcomeSchema = z.enum(["SUCCESS", "FAILURE"]);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

export const listAuditLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    action: z.string().trim().min(1).max(100).optional(),
    userId: z.string().uuid().optional(),
    targetUserId: z.string().uuid().optional(),
    outcome: auditOutcomeSchema.optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (data) =>
      !data.startDate ||
      !data.endDate ||
      new Date(data.startDate) <= new Date(data.endDate),
    {
      message: "startDate cannot be after endDate",
      path: ["startDate"],
    },
  );

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

export const auditLogItemSchema = z
  .object({
    id: z.string().uuid(),
    action: z.string().min(1).max(100),
    userId: z.string().uuid().nullable().optional(),
    targetUserId: z.string().uuid().nullable().optional(),
    outcome: auditOutcomeSchema,
    errorCode: z.string().nullable().optional(),
    metadata: z
      .union([z.record(z.unknown()), z.array(z.unknown()), z.null()])
      .optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type AuditLogItem = z.infer<typeof auditLogItemSchema>;

export const auditLogDetailResponseSchema = z
  .object({
    data: z
      .object({
        auditLog: auditLogItemSchema,
      })
      .strict(),
    error: z.null(),
    meta: z.record(z.unknown()).default({}),
  })
  .strict();

export type AuditLogDetailResponse = z.infer<
  typeof auditLogDetailResponseSchema
>;

export const paginatedAuditLogsResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(auditLogItemSchema),
        pagination: z
          .object({
            page: z.number().int().min(1),
            limit: z.number().int().min(1),
            total: z.number().int().min(0),
            totalPages: z.number().int().min(0),
          })
          .strict(),
      })
      .strict(),
    error: z.null(),
    meta: z.record(z.unknown()).default({}),
  })
  .strict();

export type PaginatedAuditLogsResponse = z.infer<
  typeof paginatedAuditLogsResponseSchema
>;
