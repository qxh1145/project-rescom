import { z } from "zod";
import { formBlockTypeEnum } from "./form-blocks.schema";

export const aiPromptSubmissionSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(10, "Survey description prompt must be at least 10 characters")
      .max(4000, "Survey description prompt cannot exceed 4000 characters"),
    targetQuestionCount: z
      .number()
      .int()
      .min(1, "Target question count must be at least 1")
      .max(30, "Target question count cannot exceed 30")
      .optional(),
    preferredBlockTypes: z.array(formBlockTypeEnum).optional(),
  })
  .strict();

export type AiPromptSubmissionInput = z.infer<typeof aiPromptSubmissionSchema>;

export const aiGatewayPromptPayloadSchema = z
  .object({
    systemPrompt: z.string().min(1, "System prompt is required"),
    formSchemaContract: z
      .object({
        schemaVersion: z.number().int().positive(),
        supportedBlockTypes: z.array(z.string()),
        constraints: z.record(z.any()).optional(),
      })
      .strict(),
    userPrompt: z.string().min(1, "User prompt is required"),
    options: z
      .object({
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().optional(),
        targetQuestionCount: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AiGatewayPromptPayload = z.infer<typeof aiGatewayPromptPayloadSchema>;
