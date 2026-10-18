import { http } from "msw";
import {
  listAuditLogsQuerySchema,
  type AuditLogItem,
  type AuditLogUserRef,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import {
  MOCK_AUDIT_LOGS,
  type MockAuditLogRow,
} from "../data/admin-audit-logs";
import { listMockAdminUsers, type MockAdminUser } from "../data/admin-users";
import { fail, ok } from "../envelope";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toUserRef(
  id: string | null,
  users: MockAdminUser[],
): AuditLogUserRef | null {
  if (!id) return null;
  const user = users.find((u) => u.id === id);
  return {
    id,
    displayName: user?.name ?? null,
  };
}

function toItem(
  row: MockAuditLogRow,
  users: MockAdminUser[],
): AuditLogItem {
  return {
    id: row.id,
    action: row.action,
    userId: row.userId,
    targetUserId: row.targetUserId,
    actor: toUserRef(row.userId, users),
    targetUser: toUserRef(row.targetUserId, users),
    outcome: row.outcome,
    errorCode: row.errorCode,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}

export const adminAuditLogsHandlers = [
  http.get(apiUrl("/admin/audit-logs"), async ({ request }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;

    const url = new URL(request.url);
    const rawParams: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) {
      rawParams[k] = v;
    }

    const parsed = listAuditLogsQuerySchema.safeParse(rawParams);
    if (!parsed.success) {
      return fail(
        400,
        "VALIDATION_ERROR",
        parsed.error.errors[0]?.message ?? "Validation failed",
        { details: parsed.error.format() },
      );
    }

    const {
      page,
      limit,
      action,
      userId,
      targetUserId,
      outcome,
      startDate,
      endDate,
    } = parsed.data;

    let rows = [...MOCK_AUDIT_LOGS];
    if (action) {
      rows = rows.filter((r) => r.action === action);
    }
    if (userId) {
      rows = rows.filter((r) => r.userId === userId);
    }
    if (targetUserId) {
      rows = rows.filter((r) => r.targetUserId === targetUserId);
    }
    if (outcome) {
      rows = rows.filter((r) => r.outcome === outcome);
    }
    if (startDate) {
      const start = new Date(startDate).getTime();
      rows = rows.filter((r) => new Date(r.createdAt).getTime() >= start);
    }
    if (endDate) {
      const end = new Date(endDate).getTime();
      rows = rows.filter((r) => new Date(r.createdAt).getTime() <= end);
    }

    rows.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = rows.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const sliced = rows.slice(start, start + limit);
    const users = listMockAdminUsers();
    const items = sliced.map((r) => toItem(r, users));

    return ok({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  }),
  http.get(apiUrl("/admin/audit-logs/:id"), async ({ params }) => {
    const forced = await applyScenario("admin");
    if (forced) return forced;
    const admin = await requireMockAdmin();
    if (admin instanceof Response) return admin;

    const id = params.id as string;
    if (!UUID_RE.test(id)) {
      return fail(
        404,
        "AUDIT_LOG_NOT_FOUND",
        "Không tìm thấy bản ghi nhật ký thao tác.",
      );
    }

    const found = MOCK_AUDIT_LOGS.find((r) => r.id === id);
    if (!found) {
      return fail(
        404,
        "AUDIT_LOG_NOT_FOUND",
        "Không tìm thấy bản ghi nhật ký thao tác.",
      );
    }

    const users = listMockAdminUsers();
    return ok({ auditLog: toItem(found, users) });
  }),
];
