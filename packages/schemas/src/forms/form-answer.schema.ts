import { z } from "zod";

export const blockAnswerValueSchema = z.union([
  z.string().max(10000, "Answer string cannot exceed 10000 characters"),
  z.number().finite(),
  z.boolean(),
  z
    .array(z.string().trim().min(1).max(500))
    .min(1)
    .max(100, "Answer array cannot exceed 100 items"),
  z.null(),
]);

export type BlockAnswerValue = z.infer<typeof blockAnswerValueSchema>;

export const blockAnswerSchema = z
  .object({
    blockId: z.string().trim().min(1, "Block ID is required").max(100),
    value: blockAnswerValueSchema,
  })
  .strict();

export type BlockAnswer = z.infer<typeof blockAnswerSchema>;

export const formSubmissionSchema = z
  .object({
    formId: z.string().trim().min(1, "Form ID is required").max(100),
    formVersionId: z
      .string()
      .trim()
      .min(1, "Form Version ID is required")
      .max(100),
    answers: z
      .array(blockAnswerSchema)
      .min(1, "At least one answer must be submitted")
      .max(200, "Answers array cannot exceed 200 items"),
  })
  .strict()
  .refine(
    (data) =>
      new Set(data.answers.map((a) => a.blockId)).size === data.answers.length,
    {
      message: "Duplicate blockId found in submitted answers",
      path: ["answers"],
    },
  );

export type FormSubmission = z.infer<typeof formSubmissionSchema>;

// Contract aliases for AC4 / AC5 compliance
export const formAnswerSubmissionSchema = formSubmissionSchema;
export type FormAnswerSubmission = FormSubmission;
export type FormAnswer = BlockAnswer;
