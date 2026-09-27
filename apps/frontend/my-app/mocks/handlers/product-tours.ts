import { http } from "msw";
import { productTourIdSchema, updateProductTourSchema, type ProductTourProgressDto } from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { productTours, productToursOf } from "../data/product-tours";
import { getMockSessionUser } from "../db/session";
import { nowIso } from "../db/store";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";

/** Mirrors `apps/backend/src/modules/product-tours/presentation/product-tours.controller.ts`. */
export const productTourHandlers = [
  http.get(apiUrl("/product-tours"), async () => {
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    return ok({ tours: productToursOf(user.id) });
  }),

  http.put(apiUrl("/product-tours/:tourId"), async ({ request, params }) => {
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const tourId = productTourIdSchema.safeParse(params.tourId);
    const body = updateProductTourSchema.safeParse(await request.json().catch(() => null));
    if (!tourId.success || !body.success) return fail(400, "VALIDATION_ERROR", "Invalid product tour update");

    let saved: ProductTourProgressDto | null = null;
    productTours.update((all) => {
      const list = all[user.id] ?? [];
      const current = list.find((row) => row.tourId === tourId.data);
      // Same rule as ProductToursService: a completed tour stays completed.
      const status = current?.status === "COMPLETED" ? "COMPLETED" : body.data.status;
      const row: ProductTourProgressDto = { tourId: tourId.data, status, step: body.data.step, updatedAt: nowIso() };
      all[user.id] = [...list.filter((item) => item.tourId !== tourId.data), row];
      saved = row;
    });
    return ok(saved);
  }),
];
