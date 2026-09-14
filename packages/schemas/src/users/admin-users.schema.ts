import { z } from "zod";

export const userRoleSchema = z.enum(["ADMIN", "PUBLISHER", "RESPONDENT"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(["ACTIVE", "LOCKED"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const listUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
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
  })
  .strict();

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
