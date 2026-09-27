import { z } from "zod";
import { userStatusSchema } from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Admin · FraudLog (Figma 11e, 62:2195) — read only ("không sửa, không xoá").
 *
 * ASSUMED API CONTRACT: `GET /admin/fraud-log`. The backend stores the evidence in
 * the append-only `fraud_logs` table (Prisma `FraudLog { userId, type, details, createdAt }`,
 * written by `participation.service` / `participation-rate-limiter`) but has no read
 * route yet. `GET /admin/audit-logs` (VERIFIED) is the identity audit trail
 * (logins, USER_STATUS_CHANGED…), not integrity evidence, so it is not reused here.
 *
 * Types: the backend `FraudLogType` (TIME_BARRIER, RATE_LIMIT, DEMO_MISMATCH,
 * RECAPTCHA_FAIL, SECURITY_VIOLATION) with its `details` keys; a wrong completion
 * code is a SECURITY_VIOLATION whose `details.action` is
 * `COMPLETION_CODE_VERIFICATION_FAILED`, shown as Figma's "COMPLETION_CODE"
 * (`fraudKindOf`). `COMPLAINT_UPHELD` (Figma) is an ASSUMED new type. Unknown
 * types still render (raw code).
 *
 * Query: `userId` (exact UUID) or `search` (short code `#7F3A`, name, email),
 * `days` (7 | 14 | 30; omitted = all time), `type` (a displayed kind, so
 * `COMPLETION_CODE` is accepted), `limit`.
 * `accounts` summarizes every user in the result: entries in the window and
 * `repeated` (repeat offender — the system only flags, an Admin decides the lock).
 */

export const FRAUD_LOG_LIMIT = 100;

const fraudLogEntrySchema = z.object({
  id: z.string(),
  userId: z.string().uuid(),
  type: z.string(),
  survey: z.object({ id: z.string(), title: z.string() }).nullable(),
  details: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type FraudLogEntry = z.infer<typeof fraudLogEntrySchema>;

const fraudLogAccountSchema = z.object({
  userId: z.string().uuid(),
  count: z.number().int().nonnegative(),
  repeated: z.boolean(),
  status: userStatusSchema,
});
export type FraudLogAccount = z.infer<typeof fraudLogAccountSchema>;

const fraudLogPageSchema = z.object({
  items: z.array(fraudLogEntrySchema),
  total: z.number().int().nonnegative(),
  windowDays: z.number().int().positive().nullable(),
  accounts: z.array(fraudLogAccountSchema),
});
export type FraudLogPage = z.infer<typeof fraudLogPageSchema>;

export type FraudLogWindow = 7 | 14 | 30 | null;

export interface FraudLogQuery {
  userId?: string;
  search?: string;
  days: FraudLogWindow;
  type?: string;
}

export function fraudLogSearch(query: FraudLogQuery): string {
  const params = new URLSearchParams();
  if (query.userId) params.set("userId", query.userId);
  const search = query.search?.trim();
  if (!query.userId && search) params.set("search", search);
  if (query.days !== null) params.set("days", String(query.days));
  if (query.type) params.set("type", query.type);
  params.set("limit", String(FRAUD_LOG_LIMIT));
  return params.toString();
}

export function listFraudLog(query: FraudLogQuery, signal?: AbortSignal): Promise<FraudLogPage> {
  return apiRequest(`/admin/fraud-log?${fraudLogSearch(query)}`, { schema: fraudLogPageSchema, signal });
}
