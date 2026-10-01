import { z } from "zod";
import { adminUserSchema, type UserRole, type UserStatus } from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Admin · Người dùng (Figma 11d, 63:2212).
 *
 * VERIFIED (`admin-users.controller.ts`, `packages/schemas/src/users/admin-users.schema.ts`,
 * `user-admin.service.ts`), ADMIN only:
 * - `GET /admin/users?page&limit&search&role&status` → `{ items, pagination }`
 * - `GET /admin/users/:id` → `{ user }`
 * - `PATCH /admin/users/:id/status` `{ status, reason? }` (CSRF) → `{ user }`. `reason`
 *   (trimmed, 10–500 chars) is required when `status` is `LOCKED` (400 `VALIDATION_ERROR`
 *   otherwise) and is stored in the audit-log metadata. Locking revokes every session of
 *   the target; 400 `CANNOT_LOCK_SELF` / `CANNOT_LOCK_LAST_ADMIN`,
 *   403 `USER_ADMIN_ACTOR_NOT_ACTIVE_ADMIN`, 404 `USER_NOT_FOUND`. Written to the audit log.
 * - `PATCH /admin/users/:id/role` `{ role }` (CSRF) → `{ user }`. Revokes every session of
 *   the target; 400 `CANNOT_DEMOTE_SELF` / `CANNOT_DEMOTE_LAST_ADMIN`.
 *
 * VERIFIED `lockReason` (shared `adminUserSchema`, mock-off plan 4.6): the reason of
 * the latest lock, read from the identity audit log; null for active accounts.
 *
 * ASSUMED API CONTRACT extensions (the backend user carries only id, email, role,
 * status, dates and `lockReason`): the Figma columns below are optional, so the
 * VERIFIED payload still parses and the screen shows "—" for what is missing.
 */

export const ADMIN_USERS_PAGE_SIZE = 20;

const profileSummarySchema = z.object({
  age: z.number().int().nullable(),
  gender: z.string().nullable(),
  location: z.string().nullable(),
  occupation: z.string().nullable(),
  fieldOfStudy: z.string().nullable(),
});

export const adminUserViewSchema = adminUserSchema.extend({
  /** ASSUMED: display name (the backend user has none). */
  name: z.string().nullable().optional(),
  /** ASSUMED: starter points unlocked ("Chưa kích hoạt" otherwise). */
  activated: z.boolean().optional(),
  /** ASSUMED: "đăng nhập Google" vs email + password. */
  signInMethod: z.enum(["PASSWORD", "GOOGLE"]).optional(),
  /** ASSUMED: wallet buckets shown as "Khả dụng" and "Chờ 48h". */
  balance: z.object({ available: z.number().int(), pending: z.number().int() }).optional(),
  /** ASSUMED: survey attempts made ("Lượt làm"). */
  attemptCount: z.number().int().nonnegative().optional(),
  /** ASSUMED: FraudLog entries in the last 14 days; `repeated` = flagged as a repeat offender. */
  fraudLog: z.object({ count14d: z.number().int().nonnegative(), repeated: z.boolean() }).optional(),
  /** ASSUMED: demographic summary ("Hồ sơ"); null when the profile is not filled. */
  profile: profileSummarySchema.nullable().optional(),
});
export type AdminUserView = z.infer<typeof adminUserViewSchema>;
export type AdminUserProfileSummary = z.infer<typeof profileSummarySchema>;

const adminUserPageSchema = z.object({
  items: z.array(adminUserViewSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  }),
});
export type AdminUserPage = z.infer<typeof adminUserPageSchema>;

const adminUserEnvelopeSchema = z.object({ user: adminUserViewSchema });

export interface AdminUserListQuery {
  page?: number;
  search?: string;
  status?: UserStatus;
  role?: UserRole;
}

/** Query string of `GET /admin/users` (only the VERIFIED params). */
export function adminUsersSearch(query: AdminUserListQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(ADMIN_USERS_PAGE_SIZE));
  const search = query.search?.trim();
  if (search) params.set("search", search);
  if (query.status) params.set("status", query.status);
  if (query.role) params.set("role", query.role);
  return params.toString();
}

export function listAdminUsers(query: AdminUserListQuery, signal?: AbortSignal): Promise<AdminUserPage> {
  return apiRequest(`/admin/users?${adminUsersSearch(query)}`, { schema: adminUserPageSchema, signal });
}

export async function getAdminUser(id: string, signal?: AbortSignal): Promise<AdminUserView> {
  const { user } = await apiRequest(`/admin/users/${encodeURIComponent(id)}`, {
    schema: adminUserEnvelopeSchema,
    signal,
  });
  return user;
}

/** Lock (reason required by the shared command) or unlock. */
export async function updateAdminUserStatus(
  id: string,
  status: UserStatus,
  reason?: string,
  signal?: AbortSignal,
): Promise<AdminUserView> {
  const trimmed = reason?.trim();
  const { user } = await apiRequest(`/admin/users/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: trimmed ? { status, reason: trimmed } : { status },
    schema: adminUserEnvelopeSchema,
    signal,
  });
  return user;
}

export async function updateAdminUserRole(id: string, role: UserRole, signal?: AbortSignal): Promise<AdminUserView> {
  const { user } = await apiRequest(`/admin/users/${encodeURIComponent(id)}/role`, {
    method: "PATCH",
    body: { role },
    schema: adminUserEnvelopeSchema,
    signal,
  });
  return user;
}
