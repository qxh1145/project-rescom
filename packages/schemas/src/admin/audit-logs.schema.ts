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

export const AUDIT_LOG_PAGE_SIZE = 50;

export const auditLogUserRefSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().nullable(),
  })
  .strict();

export type AuditLogUserRef = z.infer<typeof auditLogUserRefSchema>;

export const auditLogItemSchema = z
  .object({
    id: z.string().uuid(),
    action: z.string().min(1).max(100),
    userId: z.string().uuid().nullable().optional(),
    targetUserId: z.string().uuid().nullable().optional(),
    actor: auditLogUserRefSchema.nullable().optional(),
    targetUser: auditLogUserRefSchema.nullable().optional(),
    outcome: auditOutcomeSchema,
    errorCode: z.string().nullable().optional(),
    metadata: z
      .union([z.record(z.unknown()), z.array(z.unknown()), z.null()])
      .optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type AuditLogItem = z.infer<typeof auditLogItemSchema>;

export const auditLogDetailSchema = z
  .object({
    auditLog: auditLogItemSchema,
  })
  .strict();

export type AuditLogDetail = z.infer<typeof auditLogDetailSchema>;

export const auditLogDetailResponseSchema = z
  .object({
    data: auditLogDetailSchema,
    error: z.null(),
    meta: z.record(z.unknown()).default({}),
  })
  .strict();

export type AuditLogDetailResponse = z.infer<
  typeof auditLogDetailResponseSchema
>;

export const auditLogPageSchema = z
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
  .strict();

export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

export const paginatedAuditLogsResponseSchema = z
  .object({
    data: auditLogPageSchema,
    error: z.null(),
    meta: z.record(z.unknown()).default({}),
  })
  .strict();

export type PaginatedAuditLogsResponse = z.infer<
  typeof paginatedAuditLogsResponseSchema
>;
