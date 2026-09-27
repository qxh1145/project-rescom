import {
  productTourListSchema,
  productTourProgressSchema,
  type ProductTourId,
  type ProductTourProgressDto,
  type ProductTourStatus,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/** VERIFIED against `apps/backend/src/modules/product-tours/presentation/product-tours.controller.ts`. */
export async function getProductTours(signal?: AbortSignal): Promise<ProductTourProgressDto[]> {
  const result = await apiRequest("/product-tours", { schema: productTourListSchema, signal });
  return result.tours;
}

export function saveProductTour(
  tourId: ProductTourId,
  status: ProductTourStatus,
  step: number,
): Promise<ProductTourProgressDto> {
  return apiRequest(`/product-tours/${tourId}`, {
    method: "PUT",
    body: { status, step },
    schema: productTourProgressSchema,
  });
}
