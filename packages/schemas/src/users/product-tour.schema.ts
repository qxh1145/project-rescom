import { z } from 'zod';

/**
 * Interactive product tours (Design canvas section 20).
 *
 * Progress is stored per account (not per browser) so a tour that was
 * finished or dismissed on one device is not offered again on another.
 * `PRODUCT_TOUR_IDS` must stay identical to the Prisma `ProductTourId` enum and
 * `PRODUCT_TOUR_STATUSES` to `ProductTourStatus`.
 *
 * - FIRST_SURVEY  — 20A: take the first survey, unlock the starter points
 * - FIRST_PUBLISH — 20B: publish the first survey (Google Forms)
 * - TRACK_SURVEY  — 20C: read the progress page, 48-hour complaints
 * - FORM_BUILDER  — 20D: build a form in the drag-and-drop builder
 */
export const PRODUCT_TOUR_IDS = [
  'FIRST_SURVEY',
  'FIRST_PUBLISH',
  'TRACK_SURVEY',
  'FORM_BUILDER',
] as const;

export const productTourIdSchema = z.enum(PRODUCT_TOUR_IDS);
export type ProductTourId = z.infer<typeof productTourIdSchema>;

/**
 * IN_PROGRESS — started, `step` is the last step shown.
 * COMPLETED   — finished with "Xong".
 * DISMISSED   — closed early ("Để sau", ✕, Esc): never invited again,
 *               still resumable from the Hướng dẫn button.
 */
export const PRODUCT_TOUR_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'DISMISSED'] as const;

export const productTourStatusSchema = z.enum(PRODUCT_TOUR_STATUSES);
export type ProductTourStatus = z.infer<typeof productTourStatusSchema>;

/** Highest step index a tour may have (tours stay short: ≤ 8 steps). */
export const PRODUCT_TOUR_MAX_STEP = 7;

export const productTourProgressSchema = z.object({
  tourId: productTourIdSchema,
  status: productTourStatusSchema,
  /** Zero-based index of the last step shown. */
  step: z.number().int().min(0).max(PRODUCT_TOUR_MAX_STEP),
  updatedAt: z.string(),
});
export type ProductTourProgressDto = z.infer<typeof productTourProgressSchema>;

/** `GET /product-tours` — only tours the user has touched are listed. */
export const productTourListSchema = z.object({
  tours: z.array(productTourProgressSchema),
});
export type ProductTourListDto = z.infer<typeof productTourListSchema>;

/** `PUT /product-tours/:tourId` body. */
export const updateProductTourSchema = z
  .object({
    status: productTourStatusSchema,
    step: z.number().int().min(0).max(PRODUCT_TOUR_MAX_STEP),
  })
  .strict();
export type UpdateProductTourInput = z.infer<typeof updateProductTourSchema>;
