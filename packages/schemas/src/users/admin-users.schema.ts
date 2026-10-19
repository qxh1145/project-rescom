import { z } from "zod";
import { MAX_PAGINATION_OFFSET } from "../common/pagination.schema";

export const userRoleSchema = z.enum(["ADMIN", "PUBLISHER", "RESPONDENT"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(["ACTIVE", "LOCKED"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const listUsersQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGINATION_OFFSET, `page must be at most ${MAX_PAGINATION_OFFSET}`)
      .default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().optional(),
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .strict();

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const updateUserStatusSchema = z
  .object({
    status: userStatusSchema,
    /** Required by the admin UI when locking; retained in the audit metadata. */
    reason: z.string().trim().min(10).max(500).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.status === "LOCKED" && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "reason is required when locking a user",
      });
    }
  });

export type UpdateUserStatusDto = z.infer<typeof updateUserStatusSchema>;

export const updateUserRoleSchema = z
  .object({
    role: userRoleSchema,
  })
  .strict();

export type UpdateUserRoleDto = z.infer<typeof updateUserRoleSchema>;

export const adminUserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: userRoleSchema,
    status: userStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    /**
     * Reason given by the Admin who locked the account (identity audit log of
     * the latest effective status change); null when the account is active or
     * no reason was recorded.
     */
    lockReason: z.string().nullable().optional(),
  })
  .strict();

export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserDetailResponseSchema = z
  .object({
    data: z
      .object({
        user: adminUserSchema,
      })
      .strict(),
    error: z.null(),
    meta: z.record(z.unknown()).default({}),
  })
  .strict();

export type AdminUserDetailResponse = z.infer<
  typeof adminUserDetailResponseSchema
>;

export const paginatedAdminUsersResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(adminUserSchema),
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

export type PaginatedAdminUsersResponse = z.infer<
  typeof paginatedAdminUsersResponseSchema
>;

/** Story 14.5: Admin Direct Point Credit constants and schemas */
export const ADMIN_POINT_CREDIT_REASON_MIN = 10;
export const ADMIN_POINT_CREDIT_REASON_MAX = 500;
export const ADMIN_POINT_CREDIT_CONFIRM_THRESHOLD = 5000;
export const ADMIN_POINT_CREDIT_MAX_AMOUNT = 2_147_483_647;
export const ADMIN_CREDIT_KEY_PREFIX = "admin-credit:";

export const createAdminPointCreditSchema = z
  .object({
    amount: z
      .number()
      .int()
      .min(1)
      .max(ADMIN_POINT_CREDIT_MAX_AMOUNT),
    reason: z
      .string()
      .trim()
      .min(ADMIN_POINT_CREDIT_REASON_MIN)
      .max(ADMIN_POINT_CREDIT_REASON_MAX),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export type CreateAdminPointCreditDto = z.infer<
  typeof createAdminPointCreditSchema
>;

export const adminPointCreditSchema = z
  .object({
    journalId: z.string().uuid(),
    userId: z.string().uuid(),
    amount: z.number().int().min(1),
    reason: z.string(),
    createdAt: z.string().datetime(),
    replayed: z.boolean(),
  })
  .strict();

export type AdminPointCreditDto = z.infer<typeof adminPointCreditSchema>;

export const adminPointCreditListItemSchema = z
  .object({
    journalId: z.string().uuid(),
    amount: z.number().int().min(1),
    reason: z.string(),
    createdAt: z.string().datetime(),
    reversed: z.boolean(),
    reversalJournalId: z.string().uuid().nullable(),
    reversedAt: z.string().datetime().nullable(),
  })
  .strict();

export type AdminPointCreditListItem = z.infer<
  typeof adminPointCreditListItemSchema
>;

export const adminPointCreditListSchema = z
  .object({
    items: z.array(adminPointCreditListItemSchema),
  })
  .strict();

export type AdminPointCreditList = z.infer<typeof adminPointCreditListSchema>;

export const ADMIN_POINTS_CREDITED_EVENT_TYPE = "AdminPointsCredited";

export const adminPointsCreditedPayloadSchema = z
  .object({
    journalId: z.string().uuid(),
    userId: z.string().uuid(),
    amount: z.number().int().min(1),
    reason: z.string(),
    actorId: z.string().uuid(),
  })
  .strict();

export type AdminPointsCreditedPayload = z.infer<
  typeof adminPointsCreditedPayloadSchema
>;
