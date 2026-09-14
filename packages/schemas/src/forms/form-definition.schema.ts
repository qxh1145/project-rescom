import { z } from "zod";
import { formBlockSchema } from "./form-blocks.schema";
import { formIntegrityMetadataSchema } from "./form-integrity.schema";

export const formSettingsSchema = z
  .object({
    shuffleBlocks: z.boolean().default(false),
    progressBar: z.boolean().default(true),
    requireAuth: z.boolean().default(false),
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
    settings: formSettingsSchema.default({}),
    metadata: formIntegrityMetadataSchema.default({
      expectedEffortSeconds: 60,
      minTimeBarrierSeconds: 15,
    }),
  })
  .strict()
  .superRefine((data, ctx) => {
    const blockIds = new Set<string>();

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

      // Attention Check expectedValue validity against host block options/ranges
      const attentionCheck = block.integrity?.attentionCheck;
      if (attentionCheck && attentionCheck.isAttentionCheck) {
        const expected = attentionCheck.expectedValue;
        if (block.type === "single_choice") {
          const validValues = new Set(block.options.map((o) => o.value));
          if (typeof expected !== "string" || !validValues.has(expected)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [
                "blocks",
                i,
                "integrity",
                "attentionCheck",
                "expectedValue",
              ],
              message: `Attention check expectedValue "${String(expected)}" does not match any selectable option in block "${block.id}"`,
            });
          }
        } else if (block.type === "multiple_choice") {
          const validValues = new Set(block.options.map((o) => o.value));
          const expectedList = Array.isArray(expected) ? expected : [expected];
          const invalid = expectedList.some(
            (v) => typeof v !== "string" || !validValues.has(v),
          );
          if (invalid) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [
                "blocks",
                i,
                "integrity",
                "attentionCheck",
                "expectedValue",
              ],
              message: `Attention check expectedValue contains values not present in block "${block.id}" options`,
            });
          }
        } else if (block.type === "rating") {
          if (
            typeof expected !== "number" ||
            !Number.isInteger(expected) ||
            expected < 1 ||
            expected > block.maxRating
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [
                "blocks",
                i,
                "integrity",
                "attentionCheck",
                "expectedValue",
              ],
              message: `Attention check expectedValue must be an integer between 1 and ${block.maxRating} for rating block "${block.id}"`,
            });
          }
        } else if (block.type === "linear_scale") {
          if (
            typeof expected !== "number" ||
            expected < block.min ||
            expected > block.max
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [
                "blocks",
                i,
                "integrity",
                "attentionCheck",
                "expectedValue",
              ],
              message: `Attention check expectedValue must be within range [${block.min}, ${block.max}] for linear scale block "${block.id}"`,
            });
          }
        }
      }
    }

    if (
      data.metadata.minTimeBarrierSeconds > data.metadata.expectedEffortSeconds
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata", "minTimeBarrierSeconds"],
        message: "minTimeBarrierSeconds cannot exceed expectedEffortSeconds",
      });
    }
  });

export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type FormDefinitionInput = z.input<typeof formDefinitionSchema>;
