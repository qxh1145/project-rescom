import { z } from "zod";

export const semanticCategoryEnum = z.enum([
  "DEMOGRAPHIC",
  "PSYCHOGRAPHIC",
  "ATTENTION_CHECK",
  "BEHAVIORAL",
  "FEEDBACK",
  "GENERAL",
]);

export type SemanticCategory = z.infer<typeof semanticCategoryEnum>;

export const attentionCheckConfigSchema = z
  .object({
    isAttentionCheck: z.boolean(),
    expectedValue: z.union([
      z.string().trim().min(1),
      z.number().finite(),
      z.array(z.string().trim().min(1)).min(1),
    ]),
    failAction: z.enum(["FLAG", "DISQUALIFY"]).default("FLAG"),
  })
  .strict();

export type AttentionCheckConfig = z.infer<typeof attentionCheckConfigSchema>;

export const consistencyPairConfigSchema = z
  .object({
    pairedBlockId: z.string().trim().min(1).max(100),
    rule: z.enum(["EQUIVALENT", "OPPOSITE"]),
    tolerance: z.number().finite().min(0).optional(),
  })
  .strict();

export type ConsistencyPairConfig = z.infer<typeof consistencyPairConfigSchema>;

export const blockIntegrityMetadataSchema = z
  .object({
    attentionCheck: attentionCheckConfigSchema.optional(),
    consistencyPair: consistencyPairConfigSchema.optional(),
    semanticCategory: semanticCategoryEnum.optional(),
  })
  .strict();

export type BlockIntegrityMetadata = z.infer<
  typeof blockIntegrityMetadataSchema
>;

export const formIntegrityMetadataSchema = z
  .object({
    expectedEffortSeconds: z
      .number()
      .int()
      .min(10, "Expected effort must be at least 10 seconds")
      .max(86400, "Expected effort cannot exceed 24 hours (86400 seconds)")
      .default(60),
    minTimeBarrierSeconds: z
      .number()
      .int()
      .min(1, "Minimum time barrier must be at least 1 second")
      .max(86400, "Minimum time barrier cannot exceed 86400 seconds")
      .default(15),
  })
  .strict()
  .refine((data) => data.minTimeBarrierSeconds <= data.expectedEffortSeconds, {
    message: "minTimeBarrierSeconds cannot exceed expectedEffortSeconds",
    path: ["minTimeBarrierSeconds"],
  });

export type FormIntegrityMetadata = z.infer<typeof formIntegrityMetadataSchema>;
