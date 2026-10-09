import { z } from "zod";
import {
  formRejectionSchema,
  formStatusEnum,
  formTypeEnum,
} from "./form-draft.schema";
import { formCloseKindEnum } from "./form-publish.schema";
import { formTopicReadSchema } from "./form-topic.schema";

/**
 * IR.1: response contracts of the Publisher form calls, shared by the
 * backend controllers (`forms.controller.ts`), the frontend services and the
 * e2e suites. They mirror `FormDetailDto`, `FormSummaryDto`,
 * `FormVersionSummaryDto`, `CreateFormVersionResultDto`,
 * `FormInProgressAttemptsDto` and `PricingQuoteDto`; unknown keys pass through
 * so the backend can add fields without breaking older clients.
 *
 * - `POST /forms`, `GET /forms/:id`, `PATCH /forms/:id/draft`,
 *   `POST /forms/:id/publish|close|reopen`  → `formDetailSchema`
 * - `GET /forms`                              → `formListSchema`
 * - `GET /forms/:id/pricing-quote`            → `pricingQuoteSchema`
 * - `DELETE /forms/:id`                       → `deletedFormSchema`
 * - `POST /forms/:id/versions`                → `createdFormVersionSchema`
 * - `GET /forms/:id/versions`                 → `formVersionSummaryListSchema`
 * - `GET /forms/:id/in-progress-attempts`     → `formInProgressAttemptsSchema`
 */

const count = z.number().int().nonnegative();
const isoDate = z.string().min(1);

export const formDetailVersionSchema = z
  .object({
    id: z.string().min(1),
    formId: z.string().min(1),
    versionNumber: z.number().int(),
    schemaJson: z.unknown(),
    targetingJson: z.unknown().nullable().optional(),
    isPublished: z.boolean(),
    externalUrl: z.string().nullable().optional(),
    hasCompletionCode: z.boolean().optional(),
    publishedAt: isoDate.nullable().optional(),
    createdAt: isoDate,
  })
  .passthrough();

export const formDetailSchema = z
  .object({
    id: z.string().min(1),
    publisherId: z.string(),
    type: formTypeEnum,
    status: formStatusEnum,
    title: z.string(),
    description: z.string().nullable().optional(),
    rewardPerResponse: count,
    expectedCompletions: count,
    estimatedDurationMinutes: z.number().nullable().optional(),
    closeKind: formCloseKindEnum.nullable().optional(),
    topic: formTopicReadSchema,
    deadlineAt: isoDate.nullable().optional(),
    isOfficial: z.boolean().optional(),
    completedCompletions: count.optional(),
    escrowLocked: count.nullable().optional(),
    submittedAt: isoDate.nullable().optional(),
    closedAt: isoDate.nullable().optional(),
    rejection: formRejectionSchema.nullable().optional(),
    currentVersion: formDetailVersionSchema,
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .passthrough();
export type FormDetail = z.infer<typeof formDetailSchema>;

export const formSummarySchema = z
  .object({
    id: z.string().min(1),
    publisherId: z.string(),
    type: formTypeEnum,
    status: formStatusEnum,
    title: z.string(),
    description: z.string().nullable().optional(),
    rewardPerResponse: count,
    expectedCompletions: count,
    estimatedDurationMinutes: z.number().nullable().optional(),
    latestVersionNumber: z.number().int(),
    closeKind: formCloseKindEnum.nullable(),
    topic: formTopicReadSchema,
    deadlineAt: isoDate.nullable().optional(),
    submittedAt: isoDate.nullable().optional(),
    closedAt: isoDate.nullable().optional(),
    completedCompletions: count,
    escrowLocked: count.nullable(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .passthrough();
export type FormSummary = z.infer<typeof formSummarySchema>;

export const formListSchema = z
  .object({
    forms: z.array(formSummarySchema),
    total: count,
    page: z.number().int(),
    limit: z.number().int(),
    totalPages: z.number().int(),
  })
  .passthrough();
export type FormList = z.infer<typeof formListSchema>;

export const pricingQuoteSchema = z
  .object({
    type: formTypeEnum,
    expectedCompletions: z.number().int(),
    baseRewardPerResponse: z.number(),
    effectiveRewardPerResponse: z.number(),
    baseCost: z.number(),
    effectiveCost: z.number(),
    discountPercent: z.number(),
    discountAmount: z.number(),
    estimatedDurationMinutes: z.number().nullable(),
    pricingBand: z
      .object({
        min: z.number(),
        max: z.number(),
        suggested: z.number(),
        durationBand: z.string(),
      })
      .nullable(),
    bandCheck: z.enum([
      "EXEMPT",
      "DURATION_REQUIRED",
      "OUT_OF_BAND",
      "WITHIN_BAND",
    ]),
  })
  .passthrough();
export type PricingQuote = z.infer<typeof pricingQuoteSchema>;

export const deletedFormSchema = z.object({ id: z.string() }).passthrough();

export const createdFormVersionSchema = formDetailSchema.extend({
  interruptedAttempts: count,
});
export type CreatedFormVersion = z.infer<typeof createdFormVersionSchema>;

export const formVersionSummarySchema = z
  .object({
    id: z.string(),
    formId: z.string(),
    versionNumber: z.number().int().positive(),
    isPublished: z.boolean(),
    publishedAt: isoDate.nullable(),
    createdAt: isoDate,
  })
  .passthrough();
export const formVersionSummaryListSchema = z.array(formVersionSummarySchema);

export const formInProgressAttemptsSchema = z
  .object({
    formId: z.string(),
    status: formStatusEnum,
    inProgressAttempts: count,
    reservationWindowMinutes: count,
  })
  .passthrough();
export type FormInProgressAttempts = z.infer<
  typeof formInProgressAttemptsSchema
>;
