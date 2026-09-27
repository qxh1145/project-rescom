import { http } from "msw";
import { z } from "zod";
import { listUsersQuerySchema, updateUserRoleSchema, updateUserStatusSchema } from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import {
  activeAdminCount,
  findMockAdminUser,
  listMockAdminUsers,
  matchesUserSearch,
  setMockAdminUserRole,
  setMockAdminUserStatus,
} from "../data/admin-users";
import { fail, missingCsrf, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

/**
 * Mirrors `admin-users.controller.ts` + `user-admin.service.ts` (VERIFIED routes).
 * The extra row fields and the lock `reason` are the ASSUMED extensions of
 * `lib/admin/users-service.ts`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ASSUMED: `reason` (logged + e-mailed) on top of the VERIFIED strict `{ status }`. */
const statusBodySchema = updateUserStatusSchema.extend({ reason: z.string().trim().max(500).optional() });

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const invalidUuid = () => fail(400, "VALIDATION_ERROR", "Invalid UUID parameter");
const notFound = () => fail(404, "USER_NOT_FOUND", "User not found.");

function validationFailed(error: z.ZodError) {
  return fail(400, "VALIDATION_ERROR", error.errors[0]?.message ?? "Validation failed", {
    details: error.format(),
  });
}

async function guard(): Promise<{ id: string } | Response> {
  const forced = await applyScenario("admin");
  if (forced) return forced;
  return requireMockAdmin();
}

export const adminUserHandlers = [
  // VERIFIED: GET /admin/users?page&limit&search&role&status → { items, pagination }.
  http.get(apiUrl("/admin/users"), async ({ request }) => {
    const admin = await guard();
    if (admin instanceof Response) return admin;

    const url = new URL(request.url);
    const parsed = listUsersQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return validationFailed(parsed.error);
    const { page, limit, search, role, status } = parsed.data;

    const matching = listMockAdminUsers().filter(
      (user) =>
        (!role || user.role === role) &&
        (!status || user.status === status) &&
        (!search || matchesUserSearch(user, search)),
    );
    const total = matching.length;
    return ok({
      items: matching.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    });
  }),

  // VERIFIED: GET /admin/users/:id → { user }.
  http.get(apiUrl("/admin/users/:id"), async ({ params }) => {
    const admin = await guard();
    if (admin instanceof Response) return admin;

    const id = String(params.id);
    if (!UUID.test(id)) return invalidUuid();
    const user = findMockAdminUser(id);
    return user ? ok({ user }) : notFound();
  }),

  // VERIFIED: PATCH /admin/users/:id/status { status } (+ ASSUMED reason) → { user }.
  http.patch(apiUrl("/admin/users/:id/status"), async ({ params, request }) => {
    const admin = await guard();
    if (admin instanceof Response) return admin;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;

    const id = String(params.id);
    if (!UUID.test(id)) return invalidUuid();
    const parsed = statusBodySchema.safeParse(await readJson(request));
    if (!parsed.success) return validationFailed(parsed.error);
    const { status, reason } = parsed.data;

    if (id === admin.id && status === "LOCKED") {
      return fail(400, "CANNOT_LOCK_SELF", "Admins cannot lock their own account.");
    }
    const target = findMockAdminUser(id);
    if (!target) return notFound();
    if (target.status === status) return ok({ user: target }); // no-op, as the backend
    if (target.role === "ADMIN" && target.status === "ACTIVE" && status === "LOCKED" && activeAdminCount() <= 1) {
      return fail(400, "CANNOT_LOCK_LAST_ADMIN", "Cannot lock the sole remaining active admin account.");
    }
    // Backend: locking revokes every session of the target. Mock sessions belong to the
    // signed-in admin only; the locked account's next login gets AUTH_USER_LOCKED.
    const user = setMockAdminUserStatus(id, status, reason ?? null);
    return user ? ok({ user }) : notFound();
  }),

  // VERIFIED: PATCH /admin/users/:id/role { role } → { user }.
  http.patch(apiUrl("/admin/users/:id/role"), async ({ params, request }) => {
    const admin = await guard();
    if (admin instanceof Response) return admin;
    const csrf = missingCsrf(request);
    if (csrf) return csrf;

    const id = String(params.id);
    if (!UUID.test(id)) return invalidUuid();
    const parsed = updateUserRoleSchema.safeParse(await readJson(request));
    if (!parsed.success) return validationFailed(parsed.error);
    const { role } = parsed.data;

    if (id === admin.id && role !== "ADMIN") {
      return fail(400, "CANNOT_DEMOTE_SELF", "Admins cannot demote or alter their own admin role.");
    }
    const target = findMockAdminUser(id);
    if (!target) return notFound();
    if (target.role === role) return ok({ user: target });
    if (target.role === "ADMIN" && target.status === "ACTIVE" && activeAdminCount() <= 1) {
      return fail(400, "CANNOT_DEMOTE_LAST_ADMIN", "Cannot demote the sole remaining admin account.");
    }
    const user = setMockAdminUserRole(id, role);
    return user ? ok({ user }) : notFound();
  }),
];
