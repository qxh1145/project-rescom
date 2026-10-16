import { adminPayosTopUpListSchema, adminTopUpTabCountsSchema, payosRecheckResultSchema,
  listAdminPayosTopUpsQuerySchema, exportAdminPayosTopUpsSchema } from "@rescom/schemas";
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
