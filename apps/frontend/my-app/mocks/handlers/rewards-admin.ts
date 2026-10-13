import { http, type RequestHandler } from "msw";
import { adminCodeImportRequestSchema, adminFlashSaleInputSchema, adminFlashSaleListQuerySchema, adminFlashEndRequestSchema, rewardsStatsQuerySchema, adminStockAdjustmentSchema, adminVoucherInputSchema, adminVoucherListQuerySchema, adminVoucherPriceChangeSchema, adminVoucherStatePatchSchema } from "@rescom/schemas";
import { apiUrl, isHybridMocking } from "@/lib/api/config";
import { adminBrands, adminFlashSalesOf, adminFlashSaleDetailOf, createAdminFlashSale, updateAdminFlashSale, endAdminFlashSale, rewardsStatsOf, adminVoucherDetailOf, adminVouchersOf, adjustAdminVoucherStock, changeAdminVoucherPrice, createAdminVoucher, importAdminVoucherCodes, patchAdminVoucherState, updateAdminVoucher } from "../data/rewards";
import { fail, missingCsrf, ok } from "../envelope";
import { HYBRID_ADMIN } from "../hybrid";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

async function guard(request: Request, write = false) {
  const forced = await applyScenario("admin");
  if (forced) return forced;
  const admin = isHybridMocking ? HYBRID_ADMIN : await requireMockAdmin();
  if (admin instanceof Response) return admin;
  return write ? { admin, error: missingCsrf(request) } : { admin, error: null };
}
async function body(request: Request, schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: { format: () => unknown } } }) {
  let value: unknown;
  try { value = await request.json(); } catch { value = null; }
  const parsed = schema.safeParse(value);
  return parsed.success ? { value: parsed.data } : { error: fail(400, "VALIDATION_ERROR", "Invalid voucher request.", { details: parsed.error?.format() }) };
}
function respond(result: { ok: boolean; result?: unknown; status?: number; code?: string; details?: unknown }, status = 200) {
  return result.ok ? ok(result.result, status) : fail(result.status ?? 409, result.code ?? "VALIDATION_ERROR", result.code ?? "Invalid voucher.", { details: result.details });
}
const guarded = async (request: Request, write = false) => {
  const checked = await guard(request, write);
  return checked instanceof Response ? { error: checked } : checked;
};

/** ASSUMED API CONTRACT: backend Story 12.7. 400 VALIDATION_ERROR, 404 VOUCHER_NOT_FOUND;
 * 409 STOCK_BELOW_COMMITTED, STOCK_INCREASE_NEEDS_CODES, STOCK_EXCEEDS_CODES,
 * SHARED_CODE_VOUCHER, SHARED_FLAG_LOCKED, VOUCHER_ARCHIVED. */
export const rewardsAdminHandlers: RequestHandler[] = [
  http.get(apiUrl("/admin/rewards/vouchers"), async ({ request }) => {
    const checked = await guarded(request); if (checked.error) return checked.error;
    const query = adminVoucherListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    return query.success ? ok(adminVouchersOf(query.data)) : fail(400, "VALIDATION_ERROR", "Invalid query.", { details: query.error.format() });
  }),
  http.post(apiUrl("/admin/rewards/vouchers"), async ({ request }) => {
    const checked = await guarded(request, true); if (checked.error) return checked.error;
    const parsed = await body(request, adminVoucherInputSchema); if (parsed.error) return parsed.error;
    return respond(createAdminVoucher(parsed.value as Parameters<typeof createAdminVoucher>[0], checked.admin!), 201);
  }),
  http.get(apiUrl("/admin/rewards/brands"), async ({ request }) => {
    const checked = await guarded(request); return checked.error ?? ok(adminBrands());
  }),
  http.get(apiUrl("/admin/rewards/vouchers/:id"), async ({ request, params }) => {
    const checked = await guarded(request); return checked.error ?? respond(adminVoucherDetailOf(String(params.id)));
  }),
  http.put(apiUrl("/admin/rewards/vouchers/:id"), async ({ request, params }) => {
    const checked = await guarded(request, true); if (checked.error) return checked.error;
    const parsed = await body(request, adminVoucherInputSchema); if (parsed.error) return parsed.error;
    return respond(updateAdminVoucher(String(params.id), parsed.value as Parameters<typeof updateAdminVoucher>[1]));
  }),
  http.patch(apiUrl("/admin/rewards/vouchers/:id"), async ({ request, params }) => {
    const checked = await guarded(request, true); if (checked.error) return checked.error;
    const parsed = await body(request, adminVoucherStatePatchSchema); if (parsed.error) return parsed.error;
    return respond(patchAdminVoucherState(String(params.id), parsed.value as Parameters<typeof patchAdminVoucherState>[1]));
  }),
  http.post(apiUrl("/admin/rewards/vouchers/:id/price"), async ({ request, params }) => {
    const checked = await guarded(request, true); if (checked.error) return checked.error;
    const parsed = await body(request, adminVoucherPriceChangeSchema); if (parsed.error) return parsed.error;
    return respond(changeAdminVoucherPrice(String(params.id), parsed.value as Parameters<typeof changeAdminVoucherPrice>[1], checked.admin!));
  }),
  http.post(apiUrl("/admin/rewards/vouchers/:id/stock"), async ({ request, params }) => {
    const checked = await guarded(request, true); if (checked.error) return checked.error;
    const parsed = await body(request, adminStockAdjustmentSchema); if (parsed.error) return parsed.error;
    return respond(adjustAdminVoucherStock(String(params.id), parsed.value as Parameters<typeof adjustAdminVoucherStock>[1]));
  }),
  http.post(apiUrl("/admin/rewards/vouchers/:id/codes"), async ({ request, params }) => {
    const checked = await guarded(request, true); if (checked.error) return checked.error;
    const parsed = await body(request, adminCodeImportRequestSchema); if (parsed.error) return parsed.error;
    return respond(importAdminVoucherCodes(String(params.id), parsed.value as Parameters<typeof importAdminVoucherCodes>[1]));
  }),
  // ASSUMED API CONTRACT: backend Story 12.9. 400 VALIDATION_ERROR; 409 flash rule conflicts with details.conflicts.
  http.get(apiUrl("/admin/rewards/flash-sales"), async ({ request }) => {
    const checked = await guarded(request); if (checked.error) return checked.error;
    const query = adminFlashSaleListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    return query.success ? respond(adminFlashSalesOf(query.data)) : fail(400, "VALIDATION_ERROR", "Invalid query.", { details: query.error.format() });
  }),
  // ASSUMED API CONTRACT: backend Story 12.9. 400 VALIDATION_ERROR; 409 flash rule conflicts with details.conflicts.
  http.post(apiUrl("/admin/rewards/flash-sales"), async ({ request }) => {
    const checked = await guarded(request, true); if (checked.error) return checked.error;
    const parsed = await body(request, adminFlashSaleInputSchema); if (parsed.error) return parsed.error;
    return respond(createAdminFlashSale(parsed.value as Parameters<typeof createAdminFlashSale>[0], checked.admin!), 201);
  }),
  // ASSUMED API CONTRACT: backend Story 12.9. 404 FLASH_SALE_NOT_FOUND.
  http.get(apiUrl("/admin/rewards/flash-sales/:id"), async ({ request, params }) => {
    const checked = await guarded(request); return checked.error ?? respond(adminFlashSaleDetailOf(String(params.id)));
  }),
  // ASSUMED API CONTRACT: backend Story 12.9. 400 VALIDATION_ERROR; 404 FLASH_SALE_NOT_FOUND; 409 FLASH_ALREADY_STARTED or rule conflicts.
  http.put(apiUrl("/admin/rewards/flash-sales/:id"), async ({ request, params }) => {
    const checked = await guarded(request, true); if (checked.error) return checked.error;
    const parsed = await body(request, adminFlashSaleInputSchema); if (parsed.error) return parsed.error;
    return respond(updateAdminFlashSale(String(params.id), parsed.value as Parameters<typeof updateAdminFlashSale>[1]));
  }),
  // ASSUMED API CONTRACT: backend Story 12.9. 400 VALIDATION_ERROR; 404 FLASH_SALE_NOT_FOUND; 409 FLASH_NOT_ACTIVE or FLASH_ALREADY_ENDED.
  http.post(apiUrl("/admin/rewards/flash-sales/:id/end"), async ({ request, params }) => {
    const checked = await guarded(request, true); if (checked.error) return checked.error;
    const parsed = await body(request, adminFlashEndRequestSchema); if (parsed.error) return parsed.error;
    return respond(endAdminFlashSale(String(params.id), parsed.value as Parameters<typeof endAdminFlashSale>[1]));
  }),
  // ASSUMED API CONTRACT: backend Story 12.7. 400 VALIDATION_ERROR.
  http.get(apiUrl("/admin/rewards/stats"), async ({ request }) => {
    const checked = await guarded(request); if (checked.error) return checked.error;
    const query = rewardsStatsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    return query.success ? respond(rewardsStatsOf(query.data)) : fail(400, "VALIDATION_ERROR", "Invalid query.", { details: query.error.format() });
  }),
];
