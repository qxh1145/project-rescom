import { z } from "zod";
import { formBlockSchema } from "./form-blocks.schema";
import { formIntegrityMetadataSchema } from "./form-integrity.schema";
import { formSettingsSchema } from "./form-definition.schema";
import { surveyTargetingSchema, SurveyTargetingCriteria } from "./form-targeting.schema";

export const formTypeEnum = z.enum(["INTERNAL", "EXTERNAL"]);
export type FormTypeEnum = z.infer<typeof formTypeEnum>;

export const formStatusEnum = z.enum([
  "DRAFT",
  "ESCROW_LOCKED",
  "MODERATION_QUEUE",
  "PUBLISHED",
  "CLOSED",
]);
export type FormStatusEnum = z.infer<typeof formStatusEnum>;

/**
 * Draft Form Definition Schema:
 * Permits 0 or more blocks for in-progress drafting, while enforcing all individual block validations.
 */
export const draftFormDefinitionSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    schemaVersion: z.number().int().positive().default(1),
    title: z
      .string()
      .trim()
      .min(1, "Form title cannot be empty")
      .max(200, "Form title cannot exceed 200 characters")
      .default("Untitled Survey"),
    description: z.string().max(2000).optional(),
    blocks: z
      .array(formBlockSchema)
      .max(200, "Form cannot exceed 200 blocks")
      .default([]),
    settings: formSettingsSchema.default({}),
    metadata: formIntegrityMetadataSchema.default({
      expectedEffortSeconds: 60,
      minTimeBarrierSeconds: 15,
    }),
  })
  .strict()
  .superRefine((data, ctx) => {
    const blockIds = new Set<string>();
    const blockOrders = new Set<number>();

    for (let i = 0; i < data.blocks.length; i++) {
      const block = data.blocks[i];
      if (blockIds.has(block.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blocks", i, "id"],
          message: `Duplicate block ID "${block.id}" found in form definition`,
        });
      }
      blockIds.add(block.id);
      if (block.order >= data.blocks.length || blockOrders.has(block.order)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blocks", i, "order"],
          message: "Block order values must be unique and sequential from 0",
        });
      }
      blockOrders.add(block.order);
    }

    const pairMap = new Map<string, string>();

    for (let i = 0; i < data.blocks.length; i++) {
      const block = data.blocks[i];
      const pairedBlockId = block.integrity?.consistencyPair?.pairedBlockId;
      if (pairedBlockId) {
        if (pairedBlockId === block.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "blocks",
              i,
              "integrity",
              "consistencyPair",
              "pairedBlockId",
            ],
            message: `Block "${block.id}" cannot be paired with itself`,
          });
        } else if (!blockIds.has(pairedBlockId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "blocks",
              i,
              "integrity",
              "consistencyPair",
              "pairedBlockId",
            ],
            message: `Consistency paired block ID "${pairedBlockId}" does not exist in this form`,
          });
        } else if (pairMap.get(pairedBlockId) === block.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "blocks",
              i,
              "integrity",
              "consistencyPair",
              "pairedBlockId",
            ],
            message: `Mutual circular consistency pair detected between "${block.id}" and "${pairedBlockId}"`,
          });
        }
        pairMap.set(block.id, pairedBlockId);
      }
    }
  });

export type DraftFormDefinition = z.infer<typeof draftFormDefinitionSchema>;
export type DraftFormDefinitionInput = z.input<typeof draftFormDefinitionSchema>;

/**
 * Payload to initialize a new survey draft
 */
export const createFormDraftSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Form title cannot be empty")
      .max(200, "Form title cannot exceed 200 characters")
      .default("Untitled Survey"),
    description: z.string().max(2000).optional(),
    type: formTypeEnum.default("INTERNAL"),
    rewardPerResponse: z
      .number()
      .int("Reward must be an integer")
      .min(0, "Reward cannot be negative")
      .max(10000, "Reward cannot exceed 10,000 points")
      .default(10),
    expectedCompletions: z
      .number()
      .int("Expected completions must be an integer")
      .min(1, "Expected completions must be at least 1")
      .max(100000, "Expected completions cannot exceed 100,000")
      .default(50),
    schema: draftFormDefinitionSchema.optional(),
    targetingJson: surveyTargetingSchema.optional().nullable(),
    externalUrl: z
      .string()
      .trim()
      .url("Invalid external survey URL")
      .max(2000)
      .optional()
      .nullable(),
  })
  .strict();

export type CreateFormDraftDto = z.infer<typeof createFormDraftSchema>;
export type CreateFormDraftInput = z.input<typeof createFormDraftSchema>;

/**
 * Payload for autosaving / updating a survey draft.
 *
 * `clientUpdatedAt` enables **optimistic locking** to prevent race conditions
 * from concurrent autosave requests (e.g. debounced 1 s bursts where an older
 * in-flight request resolves after a newer one). The server compares this value
 * to the stored `updatedAt` and rejects with HTTP 409 Conflict when the
 * client's snapshot is stale (a later write already committed).
 *
 * Client contract: always echo back the `updatedAt` value received from the
 * most recent successful GET /forms/:id or PATCH /forms/:id/draft response.
 */
export const updateFormDraftSchema = z
  .object({
    /**
     * ISO-8601 timestamp of the `updatedAt` the client last observed for this
     * form. Required for all autosave calls. The server rejects the request
     * when the stored `updatedAt` is strictly greater than this value,
     * indicating another concurrent write won the race.
     */
    clientUpdatedAt: z
      .string()
      .datetime({
        message:
          "clientUpdatedAt must be a valid ISO-8601 datetime string (e.g. 2026-09-14T12:00:00.000Z)",
      }),
    title: z
      .string()
      .trim()
      .min(1, "Form title cannot be empty")
      .max(200, "Form title cannot exceed 200 characters")
      .optional(),
    description: z.string().max(2000).optional().nullable(),
    type: formTypeEnum.optional(),
    rewardPerResponse: z
      .number()
      .int("Reward must be an integer")
      .min(0, "Reward cannot be negative")
      .max(10000, "Reward cannot exceed 10,000 points")
      .optional(),
    expectedCompletions: z
      .number()
      .int("Expected completions must be an integer")
      .min(1, "Expected completions must be at least 1")
      .max(100000, "Expected completions cannot exceed 100,000")
      .optional(),
    schema: draftFormDefinitionSchema.optional(),
    /**
     * Demographic targeting criteria for Marketplace matching (Story 4.1).
     * Validated against `surveyTargetingSchema` — an empty object `{}` is valid
     * and means open-to-all. `null` clears any previously set targeting.
     * Invalid targeting (e.g. `ageRange.min > ageRange.max`) is rejected with
     * HTTP 422 / `TARGETING_VALIDATION_ERROR`.
     */
    targetingJson: surveyTargetingSchema.optional().nullable(),
    externalUrl: z
      .string()
      .trim()
      .url("Invalid external survey URL")
      .max(2000)
      .optional()
      .nullable(),
  })
  .strict();

export type UpdateFormDraftDto = z.infer<typeof updateFormDraftSchema>;
export type UpdateFormDraftInput = z.input<typeof updateFormDraftSchema>;

/**
 * Query schema for listing forms
 */
export const listFormsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: formStatusEnum.optional(),
    type: formTypeEnum.optional(),
  })
  .strict();

export type ListFormsQuery = z.infer<typeof listFormsQuerySchema>;

/**
 * Version detail representation in API responses
 */
export interface FormVersionDto {
  id: string;
  formId: string;
  versionNumber: number;
  schemaJson: DraftFormDefinition;
  /** Demographic targeting criteria. `null` means open to all respondents. */
  targetingJson: SurveyTargetingCriteria | null;
  isPublished: boolean;
  externalUrl?: string | null;
  completionCode?: string | null;
  hasCompletionCode?: boolean;
  publishedAt?: string | null;
  createdAt: string;
}

/**
 * Form detail representation in API responses
 */
export interface FormDetailDto {
  id: string;
  publisherId: string;
  type: FormTypeEnum;
  status: FormStatusEnum;
  title: string;
  description?: string | null;
  rewardPerResponse: number;
  expectedCompletions: number;
  currentVersion: FormVersionDto;
  createdAt: string;
  updatedAt: string;
}

/**
 * Form summary item representation in list API responses
 */
export interface FormSummaryDto {
  id: string;
  publisherId: string;
  type: FormTypeEnum;
  status: FormStatusEnum;
  title: string;
  description?: string | null;
  rewardPerResponse: number;
  expectedCompletions: number;
  latestVersionNumber: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lightweight version summary for version history list API responses.
 * Omits schemaJson for list performance — use FormVersionDto for full detail.
 */
export interface FormVersionSummaryDto {
  id: string;
  formId: string;
  versionNumber: number;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
}
