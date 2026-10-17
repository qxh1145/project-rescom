import { http, HttpResponse, type RequestHandler } from "msw";
import {
  exportAdminPayosTopUpsSchema,
  listAdminPayosTopUpsQuerySchema,
  PAYOS_TOP_UP_EXPORT_MAX_ROWS,
  resolveTopUpMismatchSchema,
  adminTopUpRefundListQuerySchema,
  resolveTopUpRefundSchema,
  recordTopUpRefundBankTransferSchema,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import {
  adminActionRequired,
  adminPayosRows,
  adminPayosExportRows,
  topUpTabCounts,
  adminRefundListItems,
  adminRefundDetail,
} from "../data/admin-payos-top-ups";
import { payosTopUps, type MockPayosTopUp } from "../data/top-up";
import { findMockUserByEmail, findMockUserById, type MockSessionUser } from "../db/session";
import { creditPayosTopUp, resolveRefundPayout, resolveRefundReject, walletOf } from "../data/economy";
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
function transferOutOfBounds(at: string | undefined, submittedAt: string) {
  if (!at) return false;
  const t = new Date(at).getTime();
  return t > Date.now() + 5 * 60 * 1000 || t < new Date(submittedAt).getTime();
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
  http.get(apiUrl("/admin/top-ups/action-required"), async () => { const denied = await guard(); return denied ?? ok(adminActionRequired()); }),
  http.get(apiUrl("/admin/top-ups/tab-counts"), async () => { const denied = await guard(); return denied ?? ok(topUpTabCounts()); }),
  http.get(apiUrl("/admin/top-ups/refunds"), async ({ request }) => {
    const denied = await guard(); if (denied) return denied;
    const parsed = adminTopUpRefundListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid query");
    const { status, verdict, q, page } = parsed.data;
    const all = adminRefundListItems().filter(row => {
      if (status === "OPEN" && row.status !== "REQUESTED") return false;
      if (status === "RESOLVED" && row.status !== "REFUNDED" && row.status !== "REJECTED" && row.status !== "WITHDRAWN") return false;
      if (verdict === "ELIGIBLE" && row.eligibility !== "ELIGIBLE") return false;
      if (verdict === "NOT_ELIGIBLE" && row.eligibility !== "NOT_ELIGIBLE") return false;
      if (q) {
        const query = q.toLowerCase();
        if (/^\d{1,10}$/.test(q) && row.orderCode === Number(q)) return true;
        if (row.userEmail?.toLowerCase().includes(query)) return true;
        if (row.userName?.toLowerCase().includes(query)) return true;
        return false;
      }
      return true;
    }).sort((a, b) => {
      if (status === "OPEN") {
        return a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id);
      }
      if (status === "RESOLVED") {
        const aDate = a.resolvedAt ?? "";
        const bDate = b.resolvedAt ?? "";
        if (!aDate && !bDate) return b.submittedAt.localeCompare(a.submittedAt);
        if (!aDate) return 1;
        if (!bDate) return -1;
        return bDate.localeCompare(aDate) || b.id.localeCompare(a.id);
      }
      return b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id);
    });
    const pageSize = 10;
    const offset = (page - 1) * pageSize;
    const items = all.slice(offset, offset + pageSize);
    return ok({ items, total: all.length, page, pageSize });
  }),
  http.get(apiUrl("/admin/top-ups/refunds/:requestId"), async ({ params }) => {
    const denied = await guard(); if (denied) return denied;
    const detail = adminRefundDetail(params.requestId as string);
    if (!detail) return fail(404, "TOPUP_REFUND_NOT_FOUND", "Refund request not found");
    return ok(detail);
  }),
  http.post(apiUrl("/admin/top-ups/refunds/:requestId/resolve"), async ({ request, params }) => {
    const denied = await guard(); if (denied) return denied;
    const csrf = missingCsrf(request); if (csrf) return csrf;
    const body = resolveTopUpRefundSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "VALIDATION_ERROR", "Invalid resolution body");
    const detail = adminRefundDetail(params.requestId as string);
    if (!detail) return fail(404, "TOPUP_REFUND_NOT_FOUND", "Refund request not found");

    const adminUser = await requireMockAdmin();
    if (adminUser instanceof Response) return adminUser;
    if (adminUser.id === detail.userId) {
      return fail(403, "TOPUP_SELF_REVIEW_FORBIDDEN", "Self review forbidden");
    }

    if (detail.status !== "REQUESTED") {
      if (detail.status === body.data.decision) {
        return ok({ request: detail, replayed: true });
      }
      return fail(409, "REFUND_ALREADY_RESOLVED", "Refund request is already resolved");
    }

    if (body.data.decision === "REFUNDED") {
      const holder = findMockUserById(detail.userId);
      if (detail.heldPoints === 0 || detail.eligibility !== "ELIGIBLE" || !holder || (walletOf(holder).refundHold ?? 0) < detail.points) {
        return fail(409, "REFUND_NOT_HELD", "Chỉ bật khi Điểm đang bị giữ");
      }
      if (!body.data.destinationConfirmed && !detail.destination.verified) {
        return fail(409, "REFUND_DESTINATION_UNCONFIRMED", "Destination must be confirmed");
      }
      if (transferOutOfBounds(body.data.bankTransferredAt, detail.submittedAt)) {
        return fail(400, "VALIDATION_ERROR", "bankTransferredAt is out of bounds");
      }
    } else if (body.data.decision === "REJECTED") {
      if (body.data.manualTransferRecorded && detail.heldPoints > 0) {
        return fail(400, "VALIDATION_ERROR", "manualTransferRecorded cannot be true for held requests");
      }
    }

    const adminObj = { id: adminUser.id, email: adminUser.email };
    let targetUser: MockSessionUser | null = null;
    let targetTopUp: MockPayosTopUp | null = null;
    payosTopUps.update(data => {
      for (const [userId, list] of Object.entries(data)) {
        for (const item of list) {
          const req = item.refund?.request;
          if (req && req.id === params.requestId) {
            targetUser = findMockUserById(userId);
            targetTopUp = item;
            req.status = body.data.decision;
            req.resolvedAt = new Date().toISOString();
            req.resolvedBy = adminObj;
            if (body.data.decision === "REFUNDED") {
              req.bankTransferReference = body.data.bankTransferReference ?? null;
              req.bankTransferredAt = body.data.bankTransferredAt ?? null;
              if (body.data.bankTransferReference || body.data.bankTransferredAt) {
                req.bankTransferRecordedAt = new Date().toISOString();
              }
              req.manualTransferRecorded = false;
            } else {
              req.rejectionReason = body.data.reason;
              req.manualTransferRecorded = Boolean(body.data.manualTransferRecorded);
            }
          }
        }
      }
    });
    const user = targetUser as MockSessionUser | null;
    const topUp = targetTopUp as MockPayosTopUp | null;
    if (user && topUp) {
      if (body.data.decision === "REFUNDED") {
        resolveRefundPayout(user, {
          points: topUp.points,
          topUpId: topUp.id,
          orderCode: topUp.orderCode,
          requestId: params.requestId as string,
        });
      } else if (body.data.decision === "REJECTED" && topUp.refund?.request?.eligibility === "ELIGIBLE") {
        resolveRefundReject(user, {
          points: topUp.points,
          topUpId: topUp.id,
          orderCode: topUp.orderCode,
          requestId: params.requestId as string,
        });
      }
    }
    const updated = adminRefundDetail(params.requestId as string)!;
    return ok({ request: updated, replayed: false });
  }),
  http.post(apiUrl("/admin/top-ups/refunds/:requestId/bank-transfer"), async ({ request, params }) => {
    const denied = await guard(); if (denied) return denied;
    const csrf = missingCsrf(request); if (csrf) return csrf;
    const body = recordTopUpRefundBankTransferSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "VALIDATION_ERROR", "Invalid bank transfer body");
    const detail = adminRefundDetail(params.requestId as string);
    if (!detail) return fail(404, "TOPUP_REFUND_NOT_FOUND", "Refund request not found");
    const adminUser = await requireMockAdmin();
    if (adminUser instanceof Response) return adminUser;
    if (adminUser.id === detail.userId) return fail(403, "TOPUP_SELF_REVIEW_FORBIDDEN", "Self review forbidden");
    if (detail.status !== "REFUNDED") return fail(409, "REFUND_NOT_REFUNDED", "Refund request is not refunded");
    if (detail.bankTransferReference || detail.bankTransferRecordedAt) {
      if (detail.bankTransferReference === (body.data.bankTransferReference ?? null) && detail.bankTransferredAt === (body.data.bankTransferredAt ?? null)) {
        return ok({ request: detail, replayed: true });
      }
      return fail(409, "REFUND_BANK_TRANSFER_ALREADY_RECORDED", "Bank transfer reference is already recorded");
    }
    if (transferOutOfBounds(body.data.bankTransferredAt, detail.submittedAt)) {
      return fail(400, "VALIDATION_ERROR", "bankTransferredAt is out of bounds");
    }
    payosTopUps.update(data => {
      for (const list of Object.values(data)) {
        for (const item of list) {
          const req = item.refund?.request;
          if (req && req.id === params.requestId) {
            req.bankTransferReference = body.data.bankTransferReference;
            req.bankTransferredAt = body.data.bankTransferredAt;
            req.bankTransferRecordedAt = new Date().toISOString();
          }
        }
      }
    });
    const updated = adminRefundDetail(params.requestId as string)!;
    return ok({ request: updated, replayed: false });
  }),
  http.post(apiUrl("/admin/top-ups/:id/recheck"), async ({ request, params }) => {
    const denied = await guard(); if (denied) return denied;
    const csrf = missingCsrf(request); if (csrf) return csrf;
    const row = adminPayosRows().find(item => item.id === params.id);
    if (!row) return fail(404, "TOPUP_NOT_FOUND", "Top-up not found");
    if (getActiveScenario() === "payos-provider-error") return fail(503, "TOPUP_PROVIDER_UNAVAILABLE", "Provider unavailable");
    const paid = row.orderCode === 800_000;
    const result = row.status === "MANUAL_REFUNDED" ? "REFUNDED" : row.status === "AMOUNT_MISMATCH" ? "MISMATCH" : row.status === "SUCCESSFUL" || paid ? "CREDITED" : "STILL_UNPAID";
    if (paid && row.status !== "SUCCESSFUL") {
      payosTopUps.update(data => { const stored = data[row.userId]?.find(item => item.id === row.id); if (stored) { stored.status = "SUCCESSFUL"; stored.paidAt = new Date().toISOString(); } });
      const user = row.userEmail ? findMockUserByEmail(row.userEmail) : null;
      if (user) creditPayosTopUp(user, { points: row.points, orderCode: row.orderCode });
    }
    return ok({ topUpId: row.id, result, status: paid ? "SUCCESSFUL" : row.status, amountPaidVnd: paid ? row.amountVnd : row.amountPaidVnd });
  }),
  http.post(apiUrl("/admin/top-ups/:id/resolve-mismatch"), async ({ request, params }) => {
    const denied = await guard(); if (denied) return denied;
    const csrf = missingCsrf(request); if (csrf) return csrf;
    const body = resolveTopUpMismatchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "VALIDATION_ERROR", "Invalid resolution");
    const row = adminPayosRows().find(item => item.id === params.id);
    if (!row) return fail(404, "TOPUP_NOT_FOUND", "Top-up not found");
    const { action, expectedAmountPaidVnd } = body.data;
    const storedRow = payosTopUps.get()[row.userId]?.find(item => item.id === row.id);
    if (storedRow?.mismatchResolution === action)
      return ok({ topUpId: row.id, status: row.status, pointsCredited: row.status === "SUCCESSFUL" ? row.pointsCredited : null, replayed: true });
    if (row.status !== "AMOUNT_MISMATCH") return fail(409, "TOPUP_MISMATCH_ALREADY_RESOLVED", "Already resolved");
    if (row.amountPaidVnd !== expectedAmountPaidVnd) return fail(409, "TOPUP_MISMATCH_AMOUNT_CHANGED", "Amount changed", { details: { amountPaidVnd: row.amountPaidVnd } });
    const points = Math.floor(expectedAmountPaidVnd / 200);
    if (action === "CREDIT" && points < 1) return fail(409, "TOPUP_MISMATCH_NOTHING_TO_CREDIT", "Nothing to credit");
    payosTopUps.update(data => { const stored = data[row.userId]?.find(item => item.id === row.id); if (stored) { stored.status = action === "CREDIT" ? "SUCCESSFUL" : "MANUAL_REFUNDED"; stored.mismatchResolution = action; } });
    if (action === "CREDIT") { const user = row.userEmail ? findMockUserByEmail(row.userEmail) : null; if (user) creditPayosTopUp(user, { points, orderCode: row.orderCode }); }
    return ok({ topUpId: row.id, status: action === "CREDIT" ? "SUCCESSFUL" : "MANUAL_REFUNDED", pointsCredited: action === "CREDIT" ? points : null, replayed: false });
  }),
  http.post(apiUrl("/admin/top-ups/payos/export"), async ({ request }) => {
    const denied = await guard(); if (denied) return denied;
    const csrf = missingCsrf(request); if (csrf) return csrf;
    const parsed = exportAdminPayosTopUpsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid date range");
    const rows = adminPayosExportRows().filter(row => inRange(row, parsed.data.from, parsed.data.to));
    if (rows.length > PAYOS_TOP_UP_EXPORT_MAX_ROWS) return fail(400, "TOPUP_EXPORT_TOO_LARGE", "Too many rows", { details: { maxRows: PAYOS_TOP_UP_EXPORT_MAX_ROWS } });
    const columns = [
      "orderCode", "userEmail", "amountVnd", "amountPaidVnd", "points", "pointsCredited",
      "status", "createdAt", "paidAt", "refundStatus", "refundResolvedAt", "bankTransferReference"
    ] as const;
    const escape = (value: unknown) => { const text = String(value ?? ""); return `"${(typeof value === "string" && /^[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`; };
    const csv = "\uFEFF" + [columns.join(","), ...rows.map(row => columns.map(column => escape(row[column])).join(","))].join("\r\n") + "\r\n";
    return new HttpResponse(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rescom-payos-topups-${parsed.data.from}-${parsed.data.to}.csv"` } });
  }),
];
