import {
  AUDIT_LOG_PAGE_SIZE,
  auditLogDetailSchema,
  auditLogPageSchema,
  type AuditLogItem,
  type AuditLogPage,
  type AuditLogUserRef,
  type AuditOutcome,
  type ListAuditLogsQuery,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import { auditLogSearch } from "./audit-log-view.ts";

/**
 * Admin · AuditLog (FR-ADD-13) — read only ("không sửa, không xoá").
 *
 * VERIFIED (`admin/presentation/admin-audit-logs.controller.ts`, shared
 * `listAuditLogsQuerySchema` / `auditLogPageSchema` / `auditLogDetailSchema`
 * in `@rescom/schemas` `admin/audit-logs.schema.ts`): `GET /admin/audit-logs`,
 * `GET /admin/audit-logs/:id`, ADMIN only, reading `identity_audit_logs`.
 */

export const AUDIT_LOG_LIMIT = AUDIT_LOG_PAGE_SIZE;

export type {
  AuditLogItem,
  AuditLogPage,
  AuditLogUserRef,
  AuditOutcome,
  ListAuditLogsQuery,
};

export function listAuditLogs(
  query: Partial<ListAuditLogsQuery>,
  signal?: AbortSignal,
): Promise<AuditLogPage> {
  return apiRequest(`/admin/audit-logs?${auditLogSearch(query)}`, {
    schema: auditLogPageSchema,
    signal,
  });
}

export async function getAuditLog(
  id: string,
  signal?: AbortSignal,
): Promise<AuditLogItem> {
  const result = await apiRequest(
    `/admin/audit-logs/${encodeURIComponent(id)}`,
    {
      schema: auditLogDetailSchema,
      signal,
    },
  );
  return result.auditLog;
}
