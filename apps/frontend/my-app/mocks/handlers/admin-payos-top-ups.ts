import { http, HttpResponse, type RequestHandler } from "msw";
import { exportAdminPayosTopUpsSchema, listAdminPayosTopUpsQuerySchema, PAYOS_TOP_UP_EXPORT_MAX_ROWS } from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { adminPayosRows, topUpTabCounts } from "../data/admin-payos-top-ups";
import { payosTopUps } from "../data/top-up";
import { findMockUserByEmail } from "../db/session";
import { creditPayosTopUp } from "../data/economy";
import { fail, missingCsrf, ok } from "../envelope";
import { applyScenario, getActiveScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

async function guard() {
  const forced = await applyScenario("admin"); if (forced) return forced;
  const admin = await requireMockAdmin(); return admin instanceof Response ? admin : null;
}
function inRange(row: { createdAt: string }, from?: string, to?: string) {
  const date = new Date(Date.parse(row.createdAt) + 7 * 3_600_000).toISOString().slice(0, 10);
  return (!from || date >= from) && (!to || date <= to);
}
export const adminPayosTopUpHandlers: RequestHandler[] = [
  http.get(apiUrl("/admin/top-ups/payos"), async ({ request }) => {
    const denied = await guard(); if (denied) return denied;
    const parsed = listAdminPayosTopUpsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid query");
    const { status, from, to, q, limit, offset } = parsed.data;
    const rows = adminPayosRows().filter(row => (!status || row.status === status) && inRange(row, from, to) &&
      (!q || (/^\d{1,10}$/.test(q) && Number(q) <= 2_147_483_647 ? row.orderCode === Number(q) : row.userEmail?.toLowerCase().includes(q.toLowerCase()))));
    const items = rows.slice(offset, offset + limit);
    return ok({ items, total: rows.length, limit, offset, hasMore: offset + items.length < rows.length });
  }),
  http.get(apiUrl("/admin/top-ups/tab-counts"), async () => { const denied = await guard(); return denied ?? ok(topUpTabCounts()); }),
  http.post(apiUrl("/admin/top-ups/:id/recheck"), async ({ request, params }) => {
    const denied = await guard(); if (denied) return denied;
    const csrf = missingCsrf(request); if (csrf) return csrf;
    const row = adminPayosRows().find(item => item.id === params.id);
    if (!row) return fail(404, "TOPUP_NOT_FOUND", "Top-up not found");
    if (getActiveScenario() === "payos-provider-error") return fail(503, "TOPUP_PROVIDER_UNAVAILABLE", "Provider unavailable");
    const paid = row.orderCode === 800_000;
    const result = row.status === "AMOUNT_MISMATCH" ? "MISMATCH" : row.status === "SUCCESSFUL" || paid ? "CREDITED" : "STILL_UNPAID";
    if (paid && row.status !== "SUCCESSFUL") {
      payosTopUps.update(data => { const stored = data[row.userId]?.find(item => item.id === row.id); if (stored) { stored.status = "SUCCESSFUL"; stored.paidAt = new Date().toISOString(); } });
      const user = row.userEmail ? findMockUserByEmail(row.userEmail) : null;
      if (user) creditPayosTopUp(user, { points: row.points, orderCode: row.orderCode });
    }
    return ok({ topUpId: row.id, result, status: paid ? "SUCCESSFUL" : row.status, amountPaidVnd: paid ? row.amountVnd : row.amountPaidVnd });
  }),
  http.post(apiUrl("/admin/top-ups/payos/export"), async ({ request }) => {
    const denied = await guard(); if (denied) return denied;
    const csrf = missingCsrf(request); if (csrf) return csrf;
    const parsed = exportAdminPayosTopUpsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid date range");
    const rows = adminPayosRows().filter(row => inRange(row, parsed.data.from, parsed.data.to));
    if (rows.length > PAYOS_TOP_UP_EXPORT_MAX_ROWS) return fail(400, "TOPUP_EXPORT_TOO_LARGE", "Too many rows", { details: { maxRows: PAYOS_TOP_UP_EXPORT_MAX_ROWS } });
    const columns = ["orderCode", "userEmail", "amountVnd", "amountPaidVnd", "points", "pointsCredited", "status", "createdAt", "paidAt"] as const;
    const escape = (value: unknown) => { const text = String(value ?? ""); return `"${(typeof value === "string" && /^[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`; };
    const csv = "\uFEFF" + [columns.join(","), ...rows.map(row => columns.map(column => escape(row[column])).join(","))].join("\r\n") + "\r\n";
    return new HttpResponse(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rescom-payos-topups-${parsed.data.from}-${parsed.data.to}.csv"` } });
  }),
];
