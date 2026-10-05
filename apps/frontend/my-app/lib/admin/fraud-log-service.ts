import { FRAUD_LOG_MAX_LIMIT, fraudLogPageSchema, type FraudLogPage } from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Admin · FraudLog (Figma 11e, 62:2195) — read only ("không sửa, không xoá").
 *
 * VERIFIED (`admin/presentation/admin-fraud-log.controller.ts`, shared
 * `listFraudLogQuerySchema` / `fraudLogPageSchema` in `@rescom/schemas`
 * `admin/fraud-log.schema.ts`): `GET /admin/fraud-log`, ADMIN only, reading the
 * append-only `fraud_logs` table (`FraudLog { userId, type, details, createdAt }`,
 * written by `participation.service` / `participation-rate-limiter`).
 * `GET /admin/audit-logs` is the identity audit trail (logins,
 * USER_STATUS_CHANGED…), not integrity evidence, so it is not reused here.
 *
 * Types: the backend `FraudLogType` (TIME_BARRIER, RATE_LIMIT, DEMO_MISMATCH,
 * RECAPTCHA_FAIL, SECURITY_VIOLATION) with its `details` keys; a wrong completion
 * code is a SECURITY_VIOLATION whose `details.action` is
 * `COMPLETION_CODE_VERIFICATION_FAILED`, shown as Figma's "COMPLETION_CODE"
 * (`fraudKindOf`). `COMPLAINT_UPHELD` (Figma) belongs to the deferred disputes:
 * the backend has no such row and answers an empty page for it. Unknown types
 * still render (raw code).
 *
 * Query: `userId` (exact UUID) or `search` (short code `#7F3A`, display name,
 * email), `days` (7 | 14 | 30; omitted = all time), `type` (a displayed kind, so
 * `COMPLETION_CODE` is accepted), `limit`, `cursor` (= `nextCursor`, newest first).
 * `accounts` summarizes the accounts of the whole result: entries matching the
 * filter and `repeated` (≥ 3 entries in 14 days — the system only flags, an
 * Admin decides the lock).
 */

export const FRAUD_LOG_LIMIT = FRAUD_LOG_MAX_LIMIT;

export type { FraudLogAccount, FraudLogEntry, FraudLogPage } from "@rescom/schemas";

export type FraudLogWindow = 7 | 14 | 30 | null;

export interface FraudLogQuery {
  userId?: string;
  search?: string;
  days: FraudLogWindow;
  type?: string;
  /** `nextCursor` of the previous page ("Tải thêm"). */
  cursor?: string;
}

export function fraudLogSearch(query: FraudLogQuery): string {
  const params = new URLSearchParams();
  if (query.userId) params.set("userId", query.userId);
  const search = query.search?.trim();
  if (!query.userId && search) params.set("search", search);
  if (query.days !== null) params.set("days", String(query.days));
  if (query.type) params.set("type", query.type);
  params.set("limit", String(FRAUD_LOG_LIMIT));
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

export function listFraudLog(query: FraudLogQuery, signal?: AbortSignal): Promise<FraudLogPage> {
  return apiRequest(`/admin/fraud-log?${fraudLogSearch(query)}`, { schema: fraudLogPageSchema, signal });
}
