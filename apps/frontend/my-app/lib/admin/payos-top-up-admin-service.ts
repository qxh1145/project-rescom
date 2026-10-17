import {
  adminPayosTopUpListSchema,
  adminTopUpTabCountsSchema,
  payosRecheckResultSchema,
  listAdminPayosTopUpsQuerySchema,
  exportAdminPayosTopUpsSchema,
  adminTopUpActionRequiredSchema,
  resolveTopUpMismatchSchema,
  resolveTopUpMismatchResultSchema,
  type ResolveTopUpMismatch,
  adminTopUpRefundListQuerySchema,
  adminTopUpRefundListResponseSchema,
  adminTopUpRefundDetailSchema,
  resolveTopUpRefundSchema,
  adminResolveTopUpRefundResultSchema,
  recordTopUpRefundBankTransferSchema,
  type ResolveTopUpRefund,
  type RecordTopUpRefundBankTransfer,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

export function listAdminPayosTopUps(query: Record<string, unknown>, signal?: AbortSignal) {
  const parsed = listAdminPayosTopUpsQuerySchema.parse(query);
  return apiRequest(`/admin/top-ups/payos?${new URLSearchParams(Object.entries(parsed).map(([k, v]) => [k, String(v)])).toString()}`,
    { schema: adminPayosTopUpListSchema, signal });
}
export function getAdminTopUpTabCounts(signal?: AbortSignal) {
  return apiRequest("/admin/top-ups/tab-counts", { schema: adminTopUpTabCountsSchema, signal });
}
export function recheckPayosTopUp(id: string) {
  return apiRequest(`/admin/top-ups/${encodeURIComponent(id)}/recheck`, { method: "POST", schema: payosRecheckResultSchema });
}
export function exportPayosTopUps(range: { from: string; to: string }) {
  return apiRequest<{ blob: Blob; fileName: string | null }>("/admin/top-ups/payos/export",
    { method: "POST", body: exportAdminPayosTopUpsSchema.parse(range), as: "blob" });
}

export function getAdminTopUpActionRequired(signal?: AbortSignal) {
  return apiRequest("/admin/top-ups/action-required", { schema: adminTopUpActionRequiredSchema, signal });
}
export function resolveTopUpMismatch(id: string, body: ResolveTopUpMismatch) {
  return apiRequest(`/admin/top-ups/${encodeURIComponent(id)}/resolve-mismatch`, { method: "POST", body: resolveTopUpMismatchSchema.parse(body), schema: resolveTopUpMismatchResultSchema });
}

export function listAdminTopUpRefunds(query: Record<string, unknown>, signal?: AbortSignal) {
  const parsed = adminTopUpRefundListQuerySchema.parse(query);
  const searchParams = new URLSearchParams(
    Object.entries(parsed)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
  return apiRequest(`/admin/top-ups/refunds?${searchParams.toString()}`,
    { schema: adminTopUpRefundListResponseSchema, signal });
}

export function getAdminTopUpRefund(id: string, signal?: AbortSignal) {
  return apiRequest(`/admin/top-ups/refunds/${encodeURIComponent(id)}`, { schema: adminTopUpRefundDetailSchema, signal });
}

export function resolveAdminTopUpRefund(id: string, body: ResolveTopUpRefund) {
  return apiRequest(`/admin/top-ups/refunds/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: resolveTopUpRefundSchema.parse(body),
    schema: adminResolveTopUpRefundResultSchema,
  });
}

export function recordAdminTopUpRefundBankTransfer(id: string, body: RecordTopUpRefundBankTransfer) {
  return apiRequest(`/admin/top-ups/refunds/${encodeURIComponent(id)}/bank-transfer`, {
    method: "POST",
    body: recordTopUpRefundBankTransferSchema.parse(body),
    schema: adminResolveTopUpRefundResultSchema,
  });
}
