import { z } from "zod";
import { formBlockSchema } from "./form-blocks.schema";
import { formIntegrityMetadataSchema } from "./form-integrity.schema";
import { validateAttentionChecks } from "./attention-check.validation";
import { computeInternalTimeBarrier } from "../participation/bot-protection";

/** A named group of blocks stored with the immutable form version. */
export const formSectionSchema = z
  .object({
    id: z.string().trim().min(1, "Section ID is required").max(100),
    title: z.string().trim().min(1, "Section title is required").max(200),
    blockIds: z.array(z.string().trim().min(1).max(100)).max(200),
  })
  .strict();

export type FormSection = z.infer<typeof formSectionSchema>;

export function validateFormSections(
  data: { blocks: Array<{ id: string }>; sections?: FormSection[] },
  ctx: z.RefinementCtx,
): void {
  if (data.sections === undefined) return;

  const knownBlockIds = new Set(data.blocks.map((block) => block.id));
  const sectionIds = new Set<string>();
  const assignedBlockIds = new Set<string>();

  data.sections.forEach((section, sectionIndex) => {
    if (sectionIds.has(section.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections", sectionIndex, "id"],
        message: `Duplicate section ID "${section.id}" found in form definition`,
      });
    }
    sectionIds.add(section.id);

    section.blockIds.forEach((blockId, blockIndex) => {
      if (!knownBlockIds.has(blockId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", sectionIndex, "blockIds", blockIndex],
          message: `Section references unknown block ID "${blockId}"`,
        });
      } else if (assignedBlockIds.has(blockId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", sectionIndex, "blockIds", blockIndex],
          message: `Block ID "${blockId}" belongs to more than one section`,
        });
      }
      assignedBlockIds.add(blockId);
    });
  });

  if (data.sections.length > 0 && data.blocks.some((block) => !assignedBlockIds.has(block.id))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sections"],
      message: "Every block must belong to exactly one section when sections are present",
    });
  }
}

export const formSettingsSchema = z
  .object({
    shuffleBlocks: z.boolean().default(false),
    progressBar: z.boolean().default(true),
    requireAuth: z.boolean().default(false),
    allowPublicAccess: z.boolean().default(true),
    submitButtonText: z
      .string()
      .trim()
      .min(1, "Submit button text cannot be empty")
      .max(50)
      .default("Submit"),
  })
  .strict();

export type FormSettings = z.infer<typeof formSettingsSchema>;

export const formDefinitionSchema = z
  .object({
    id: z.string().trim().min(1, "Form ID is required").max(100).optional(),
    schemaVersion: z.number().int().positive().default(1),
    title: z
      .string()
      .trim()
      .min(1, "Form title is required")
      .max(200, "Form title cannot exceed 200 characters"),
    description: z.string().max(2000).optional(),
    blocks: z
      .array(formBlockSchema)
      .min(1, "Form must contain at least one question block")
      .max(200, "Form cannot exceed 200 blocks"),
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

    if (
      data.metadata.minTimeBarrierSeconds > data.metadata.expectedEffortSeconds
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata", "minTimeBarrierSeconds"],
        message: "minTimeBarrierSeconds cannot exceed expectedEffortSeconds",
      });
    } else {
      // FR-14: the effective Internal barrier (answerable questions x 2 s or
      // the publisher minimum) is a floor on the real completion time, so the
      // declared effort cannot be shorter than it.
      const { requiredSeconds } = computeInternalTimeBarrier(data);
      if (requiredSeconds > data.metadata.expectedEffortSeconds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["metadata", "expectedEffortSeconds"],
          message: `expectedEffortSeconds (${data.metadata.expectedEffortSeconds} s) cannot be shorter than the required minimum completion time (${requiredSeconds} s)`,
        });
      }
    }
  });

export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type FormDefinitionInput = z.input<typeof formDefinitionSchema>;
