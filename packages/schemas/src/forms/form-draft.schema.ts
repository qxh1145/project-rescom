import { z } from "zod";
import { formBlockSchema } from "./form-blocks.schema";
import { formIntegrityMetadataSchema } from "./form-integrity.schema";
import {
  formSectionSchema,
  formSettingsSchema,
  validateFormSections,
} from "./form-definition.schema";
import { validateAttentionChecks } from "./attention-check.validation";
import { surveyTargetingSchema, SurveyTargetingCriteria } from "./form-targeting.schema";
import { externalSurveyUrlSchema } from "./external-url.schema";
import { estimatedDurationMinutesSchema } from "../economy/pricing.schema";
import { MAX_PAGINATION_OFFSET } from "../common/pagination.schema";
import type { FormCloseKind } from "./form-publish.schema";
import { formDeadlineAtSchema, formTopicEnum, type FormTopic } from "./form-topic.schema";

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
    sections: z.array(formSectionSchema).max(50).optional(),
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

    validateFormSections(data, ctx);

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

    validateAttentionChecks(data.blocks, ctx);
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
    /**
     * Publisher's estimated completion time (decision E6-D2). Optional on a
     * draft; a rewarded survey needs it at publish, where the FR-14 pricing
     * band of this duration is enforced.
     */
    estimatedDurationMinutes: estimatedDurationMinutesSchema.optional().nullable(),
    schema: draftFormDefinitionSchema.optional(),
    targetingJson: surveyTargetingSchema.optional().nullable(),
    externalUrl: externalSurveyUrlSchema.optional().nullable(),
    /** Plan 2.2: the survey topic (`FORM_TOPICS`); null = none chosen. */
    topic: formTopicEnum.optional().nullable(),
    /**
     * Story IR.2b Q1: collection deadline (1 h – 180 d ahead, checked by the
     * server); null = no deadline. New starts stop at it and the survey closes
     * (refunding its leftover Escrow) shortly after.
     */
    deadlineAt: formDeadlineAtSchema.optional().nullable(),
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
    /** Estimated completion time; `null` clears it (decision E6-D2). */
    estimatedDurationMinutes: estimatedDurationMinutesSchema.optional().nullable(),
    schema: draftFormDefinitionSchema.optional(),
    /**
     * Demographic targeting criteria for Marketplace matching (Story 4.1).
     * Validated against `surveyTargetingSchema` — an empty object `{}` is valid
     * and means open-to-all. `null` clears any previously set targeting.
     * Invalid targeting (e.g. `ageRange.min > ageRange.max`) is rejected with
     * HTTP 422 / `TARGETING_VALIDATION_ERROR`.
     */
    targetingJson: surveyTargetingSchema.optional().nullable(),
    externalUrl: externalSurveyUrlSchema.optional().nullable(),
    /** Plan 2.2: `null` clears the topic. */
    topic: formTopicEnum.optional().nullable(),
    /** Story IR.2b Q1: `null` clears the deadline; editable only in DRAFT. */
    deadlineAt: formDeadlineAtSchema.optional().nullable(),
  })
  .strict();

export type UpdateFormDraftDto = z.infer<typeof updateFormDraftSchema>;
export type UpdateFormDraftInput = z.input<typeof updateFormDraftSchema>;

/**
 * Query schema for listing forms
 */
export const listFormsQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGINATION_OFFSET, `page must be at most ${MAX_PAGINATION_OFFSET}`)
      .default(1),
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
  /** Estimated completion time in minutes (decision E6-D2); null when unset. */
  estimatedDurationMinutes?: number | null;
  /**
   * Who closed the survey most recently (decision E8-D1, `formCloseKindEnum`);
   * null when it was never closed (or closed before the close kind was
   * recorded). Only an `OWNER` close can be reopened.
   */
  closeKind?: FormCloseKind | null;
  /** Plan 2.2: the survey topic (`FORM_TOPICS`); null when none was chosen. */
  topic?: FormTopic | null;
  /** Story IR.2b: collection deadline (ISO); null = no deadline. */
  deadlineAt?: string | null;
  /**
   * `GET /forms/:id` only (Phase 5 M1/M2): completed participations so far
   * (quota definition, guests included).
   */
  completedCompletions?: number;
  /**
   * `GET /forms/:id` only (Phase 5 M1): unused Escrow the survey still holds —
   * what closing it now would refund (points owed to completed but unsettled
   * responses excluded). `null` when the server cannot compute it.
   */
  escrowLocked?: number | null;
  /**
   * `GET /forms/:id` only (IR.4a / mock-off plan Phase 3): when the survey
   * entered the moderation queue (`MODERATION_QUEUE` only, else null).
   */
  submittedAt?: string | null;
  /** `GET /forms/:id` only: when the survey closed (`CLOSED` only, else null). */
  closedAt?: string | null;
  /**
   * `GET /forms/:id` only: the Admin rejection of a survey closed by moderation
   * (`closeKind` MODERATION), from its `SurveyModerationDecision`; null otherwise.
   */
  rejection?: FormRejectionDto | null;
  currentVersion: FormVersionDto;
  createdAt: string;
  updatedAt: string;
}

/** Admin rejection of a submitted version (`SurveyModerationDecision`, outcome REJECTED). */
export const formRejectionSchema = z
  .object({
    reason: z.string(),
    /** Escrow points refunded to the Publisher by the rejection. */
    refundAmount: z.number().int().nonnegative(),
    decidedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type FormRejectionDto = z.infer<typeof formRejectionSchema>;

/**
 * Code-review decision E5-D4 (2026-09-26, option A — strict): "Create New
 * Version" moves a live survey to DRAFT at once, so every respondent still
 * taking the published version is cut off (their submission or code
 * verification is refused). `GET /forms/:id/in-progress-attempts` lets the
 * builder warn the Publisher before confirming.
 */
export interface FormInProgressAttemptsDto {
  formId: string;
  status: FormStatusEnum;
  /** Unexpired IN_PROGRESS attempts on the form (each holds a reservation). */
  inProgressAttempts: number;
  reservationWindowMinutes: number;
}

/** `POST /forms/:id/versions` (decision E5-D4): the new draft + the impact. */
export interface CreateFormVersionResultDto extends FormDetailDto {
  /** In-progress attempts on the previous published version that were cut off. */
  interruptedAttempts: number;
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
  estimatedDurationMinutes?: number | null;
  latestVersionNumber: number;
  /** Who closed the survey most recently (see `FormDetailDto.closeKind`). */
  closeKind: FormCloseKind | null;
  /** Plan 2.2 (see `FormDetailDto.topic`). */
  topic?: FormTopic | null;
  /** Story IR.2b (see `FormDetailDto.deadlineAt`). */
  deadlineAt?: string | null;
  /** Mock-off plan Phase 3 (see `FormDetailDto.submittedAt`). */
  submittedAt?: string | null;
  /** Mock-off plan Phase 3 (see `FormDetailDto.closedAt`). */
  closedAt?: string | null;
  /** Completed participations so far (quota definition, guests included). */
  completedCompletions: number;
  /**
   * Unused Escrow the survey still holds (see `FormDetailDto.escrowLocked`);
   * `null` when the server cannot compute it.
   */
  escrowLocked: number | null;
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
