import type { ProductTourProgressDto } from "@rescom/schemas";
import { createCollection } from "../db/store";

/** Tour progress per user id. Empty seed = a brand-new account sees the welcome invite. */
export const productTours = createCollection<Record<string, ProductTourProgressDto[]>>("product-tours", () => ({}));

export function productToursOf(userId: string): ProductTourProgressDto[] {
  return productTours.get()[userId] ?? [];
}
