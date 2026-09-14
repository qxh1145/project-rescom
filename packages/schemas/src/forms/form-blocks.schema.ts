import { z } from "zod";
import { blockIntegrityMetadataSchema } from "./form-integrity.schema";

export const formBlockTypeEnum = z.enum([
  "text",
  "textarea",
  "number",
  "single_choice",
  "multiple_choice",
  "rating",
  "linear_scale",
  "date",
  "file_upload",
]);

export type FormBlockType = z.infer<typeof formBlockTypeEnum>;

export const choiceOptionSchema = z
  .object({
    id: z.string().trim().min(1, "Option ID is required").max(100),
    label: z.string().trim().min(1, "Option label is required").max(300),
    value: z.string().trim().min(1, "Option value is required").max(300),
  })
  .strict();

export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

const baseBlockSchema = z.object({
  id: z.string().trim().min(1, "Block ID is required").max(100),
  order: z.number().int().min(0, "Order must be non-negative"),
  title: z
    .string()
    .trim()
    .min(1, "Question title is required")
    .max(500, "Question title cannot exceed 500 characters"),
  description: z.string().max(2000).optional(),
  required: z.boolean().default(false),
  integrity: blockIntegrityMetadataSchema.optional(),
});

// --- Text Block ---
export const textBlockBaseSchema = baseBlockSchema
  .extend({
    type: z.literal("text"),
    placeholder: z.string().max(200).optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    pattern: z.string().trim().max(500).optional(),
  })
  .strict();

function validateTextBlock(
  b: z.infer<typeof textBlockBaseSchema>,
  ctx: z.RefinementCtx,
) {
  if (
    b.minLength !== undefined &&
    b.maxLength !== undefined &&
    b.minLength > b.maxLength
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minLength"],
      message: "minLength cannot exceed maxLength",
    });
  }
  if (b.pattern) {
    try {
      new RegExp(b.pattern);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pattern"],
        message: "pattern must be a valid regular expression",
      });
    }
  }
}

export const textBlockSchema =
  textBlockBaseSchema.superRefine(validateTextBlock);
export type TextBlock = z.infer<typeof textBlockSchema>;

// --- Textarea Block ---
export const textareaBlockBaseSchema = baseBlockSchema
  .extend({
    type: z.literal("textarea"),
    placeholder: z.string().max(200).optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
  })
  .strict();

function validateTextareaBlock(
  b: z.infer<typeof textareaBlockBaseSchema>,
  ctx: z.RefinementCtx,
) {
  if (
    b.minLength !== undefined &&
    b.maxLength !== undefined &&
    b.minLength > b.maxLength
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minLength"],
      message: "minLength cannot exceed maxLength",
    });
  }
}

export const textareaBlockSchema = textareaBlockBaseSchema.superRefine(
  validateTextareaBlock,
);
export type TextareaBlock = z.infer<typeof textareaBlockSchema>;

// --- Number Block ---
export const numberBlockBaseSchema = baseBlockSchema
  .extend({
    type: z.literal("number"),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    integerOnly: z.boolean().default(false),
    placeholder: z.string().max(100).optional(),
  })
  .strict();

function validateNumberBlock(
  b: z.infer<typeof numberBlockBaseSchema>,
  ctx: z.RefinementCtx,
) {
  if (b.min !== undefined && b.max !== undefined && b.min > b.max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["min"],
      message: "min cannot exceed max",
    });
  }
  if (b.integerOnly) {
    if (b.min !== undefined && !Number.isInteger(b.min)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["min"],
        message: "min must be an integer when integerOnly is true",
      });
    }
    if (b.max !== undefined && !Number.isInteger(b.max)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max"],
        message: "max must be an integer when integerOnly is true",
      });
    }
    if (b.step !== undefined && !Number.isInteger(b.step)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["step"],
        message: "step must be an integer when integerOnly is true",
      });
    }
  }
}

export const numberBlockSchema =
  numberBlockBaseSchema.superRefine(validateNumberBlock);
export type NumberBlock = z.infer<typeof numberBlockSchema>;

// --- Choice Option Duplicate Validation Helper ---
function validateChoiceOptions(options: ChoiceOption[], ctx: z.RefinementCtx) {
  const seenIds = new Set<string>();
  const seenValues = new Set<string>();

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (seenIds.has(opt.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options", i, "id"],
        message: `Duplicate option ID "${opt.id}" found in block`,
      });
    }
    seenIds.add(opt.id);

    if (seenValues.has(opt.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options", i, "value"],
        message: `Duplicate option value "${opt.value}" found in block`,
      });
    }
    seenValues.add(opt.value);
  }
}

// --- Single Choice Block ---
export const singleChoiceBlockBaseSchema = baseBlockSchema
  .extend({
    type: z.literal("single_choice"),
    options: z
      .array(choiceOptionSchema)
      .min(2, "Single choice requires at least 2 options")
      .max(100, "Single choice cannot exceed 100 options"),
    allowOther: z.boolean().default(false),
  })
  .strict();

function validateSingleChoiceBlock(
  b: z.infer<typeof singleChoiceBlockBaseSchema>,
  ctx: z.RefinementCtx,
) {
  validateChoiceOptions(b.options, ctx);
}

export const singleChoiceBlockSchema = singleChoiceBlockBaseSchema.superRefine(
  validateSingleChoiceBlock,
);
export type SingleChoiceBlock = z.infer<typeof singleChoiceBlockSchema>;

// --- Multiple Choice Block ---
export const multipleChoiceBlockBaseSchema = baseBlockSchema
  .extend({
    type: z.literal("multiple_choice"),
    options: z
      .array(choiceOptionSchema)
      .min(2, "Multiple choice requires at least 2 options")
      .max(100, "Multiple choice cannot exceed 100 options"),
    minSelections: z.number().int().min(1).optional(),
    maxSelections: z.number().int().min(1).optional(),
    allowOther: z.boolean().default(false),
  })
  .strict();

function validateMultipleChoiceBlock(
  b: z.infer<typeof multipleChoiceBlockBaseSchema>,
  ctx: z.RefinementCtx,
) {
  validateChoiceOptions(b.options, ctx);

  if (
    b.minSelections !== undefined &&
    b.maxSelections !== undefined &&
    b.minSelections > b.maxSelections
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minSelections"],
      message: "minSelections cannot exceed maxSelections",
    });
  }

  const maxAllowedOptions = b.options.length + (b.allowOther ? 1 : 0);
  if (b.minSelections !== undefined && b.minSelections > maxAllowedOptions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minSelections"],
      message:
        'minSelections cannot exceed total available options (including "other" if allowed)',
    });
  }
  if (b.maxSelections !== undefined && b.maxSelections > maxAllowedOptions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxSelections"],
      message:
        'maxSelections cannot exceed total available options (including "other" if allowed)',
    });
  }
}

export const multipleChoiceBlockSchema =
  multipleChoiceBlockBaseSchema.superRefine(validateMultipleChoiceBlock);
export type MultipleChoiceBlock = z.infer<typeof multipleChoiceBlockSchema>;

// --- Rating Block ---
export const ratingBlockShapeEnum = z.enum(["STAR", "NUMBER", "HEART"]);

export const ratingBlockBaseSchema = baseBlockSchema
  .extend({
    type: z.literal("rating"),
    maxRating: z.number().int().min(3).max(10).default(5),
    ratingShape: ratingBlockShapeEnum.default("STAR"),
  })
  .strict();

export const ratingBlockSchema = ratingBlockBaseSchema;
export type RatingBlock = z.infer<typeof ratingBlockSchema>;

// --- Linear Scale Block ---
export const linearScaleBlockBaseSchema = baseBlockSchema
  .extend({
    type: z.literal("linear_scale"),
    min: z.union([z.literal(0), z.literal(1)]).default(1),
    max: z.number().int().min(3).max(10).default(5),
    minLabel: z.string().max(100).optional(),
    maxLabel: z.string().max(100).optional(),
    step: z.number().int().min(1).default(1),
  })
  .strict();

function validateLinearScaleBlock(
  b: z.infer<typeof linearScaleBlockBaseSchema>,
  ctx: z.RefinementCtx,
) {
  const range = b.max - b.min;
  if (b.step > range) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["step"],
      message: "step cannot exceed total scale range (max - min)",
    });
  } else if (range % b.step !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["step"],
      message: "Scale range (max - min) must be evenly divisible by step",
    });
  }
}

export const linearScaleBlockSchema = linearScaleBlockBaseSchema.superRefine(
  validateLinearScaleBlock,
);
export type LinearScaleBlock = z.infer<typeof linearScaleBlockSchema>;

// --- Date Block ---
const dateStringRegex =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export const dateBlockBaseSchema = baseBlockSchema
  .extend({
    type: z.literal("date"),
    minDate: z
      .string()
      .trim()
      .regex(
        dateStringRegex,
        "minDate must be a valid ISO date string (YYYY-MM-DD)",
      )
      .optional(),
    maxDate: z
      .string()
      .trim()
      .regex(
        dateStringRegex,
        "maxDate must be a valid ISO date string (YYYY-MM-DD)",
      )
      .optional(),
    includeTime: z.boolean().default(false),
  })
  .strict();

function validateDateBlock(
  b: z.infer<typeof dateBlockBaseSchema>,
  ctx: z.RefinementCtx,
) {
  if (b.minDate && b.maxDate) {
    const minTime = new Date(b.minDate).getTime();
    const maxTime = new Date(b.maxDate).getTime();
    if (minTime > maxTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minDate"],
        message: "minDate cannot be chronologically later than maxDate",
      });
    }
  }
}

export const dateBlockSchema =
  dateBlockBaseSchema.superRefine(validateDateBlock);
export type DateBlock = z.infer<typeof dateBlockSchema>;

// --- File Upload Block ---
export const fileUploadBlockBaseSchema = baseBlockSchema
  .extend({
    type: z.literal("file_upload"),
    maxFileSizeMb: z
      .number()
      .finite()
      .min(0.1, "File size must be at least 0.1 MB")
      .max(50)
      .default(10),
    allowedMimeTypes: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[-\w.]+\/[-\w.+]+$/, "Invalid MIME type format"),
      )
      .min(1, "At least one allowed MIME type must be specified")
      .max(50),
    maxFiles: z.number().int().min(1).max(10).default(1),
  })
  .strict();

export const fileUploadBlockSchema = fileUploadBlockBaseSchema;
export type FileUploadBlock = z.infer<typeof fileUploadBlockSchema>;

// --- Discriminated Union ---
export const formBlockSchema = z
  .discriminatedUnion("type", [
    textBlockBaseSchema,
    textareaBlockBaseSchema,
    numberBlockBaseSchema,
    singleChoiceBlockBaseSchema,
    multipleChoiceBlockBaseSchema,
    ratingBlockBaseSchema,
    linearScaleBlockBaseSchema,
    dateBlockBaseSchema,
    fileUploadBlockBaseSchema,
  ])
  .superRefine((block, ctx) => {
    switch (block.type) {
      case "text":
        validateTextBlock(block, ctx);
        break;
      case "textarea":
        validateTextareaBlock(block, ctx);
        break;
      case "number":
        validateNumberBlock(block, ctx);
        break;
      case "single_choice":
        validateSingleChoiceBlock(block, ctx);
        break;
      case "multiple_choice":
        validateMultipleChoiceBlock(block, ctx);
        break;
      case "linear_scale":
        validateLinearScaleBlock(block, ctx);
        break;
      case "date":
        validateDateBlock(block, ctx);
        break;
    }
  });

export type FormBlock = z.infer<typeof formBlockSchema>;
export type FormBlockInput = z.input<typeof formBlockSchema>;
