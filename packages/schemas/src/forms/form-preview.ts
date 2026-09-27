import { z } from "zod";
import type { FormBlock } from "./form-blocks.schema";
import { draftFormDefinitionSchema, type DraftFormDefinition } from "./form-draft.schema";
import {
  MAX_ANSWER_STRING_LENGTH,
  type FormSubmission,
  type BlockAnswer,
} from "./form-answer.schema";
import { isoDateUpperBound, parseStrictIsoDate } from "./iso-date";
import { fileAttachmentAnswerSchema } from "../storage/file-storage.schema";

export interface AnswerValidationResult {
  isValid: boolean;
  error?: string;
}

export interface FormAnswersValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  answeredCount: number;
  requiredCount: number;
}

export interface MockFileValue {
  name: string;
  size: number;
  type?: string;
}

/**
 * Parse and normalize a form definition draft.
 * Ensures blocks are sorted by sequential order index.
 */
export function parseFormDefinitionDraft(raw: unknown):
  | { success: true; data: DraftFormDefinition }
  | { success: false; errors: z.ZodError } {
  const parsed = draftFormDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, errors: parsed.error };
  }

  const sortedBlocks = [...parsed.data.blocks].sort((a, b) => a.order - b.order);
  return {
    success: true,
    data: {
      ...parsed.data,
      blocks: sortedBlocks,
    },
  };
}

/**
 * Validate a single block answer against the block's schema and constraints.
 */
export function validateBlockAnswer(
  block: FormBlock,
  value: unknown
): AnswerValidationResult {
  const isValueProvided =
    value !== undefined &&
    value !== null &&
    value !== "" &&
    (!Array.isArray(value) || value.length > 0) &&
    (typeof value !== "string" || value.trim().length > 0);

  if (block.required && !isValueProvided) {
    return { isValid: false, error: "This question is required" };
  }

  if (!isValueProvided) {
    return { isValid: true };
  }

  switch (block.type) {
    case "text": {
      if (typeof value !== "string") {
        return { isValid: false, error: "Answer must be text" };
      }
      const trimmed = value.trim();
      if (block.minLength !== undefined && trimmed.length < block.minLength) {
        return {
          isValid: false,
          error: `Minimum length is ${block.minLength} characters`,
        };
      }
      const maxLength = block.maxLength ?? MAX_ANSWER_STRING_LENGTH;
      if (trimmed.length > maxLength) {
        return {
          isValid: false,
          error: `Maximum length is ${maxLength} characters`,
        };
      }
      if (block.pattern && !new RegExp(block.pattern).test(value)) {
        return { isValid: false, error: "Answer does not match the required format" };
      }
      return { isValid: true };
    }

    case "textarea": {
      if (typeof value !== "string") {
        return { isValid: false, error: "Answer must be text" };
      }
      const trimmed = value.trim();
      if (block.minLength !== undefined && trimmed.length < block.minLength) {
        return {
          isValid: false,
          error: `Minimum length is ${block.minLength} characters`,
        };
      }
      const maxLength = block.maxLength ?? MAX_ANSWER_STRING_LENGTH;
      if (trimmed.length > maxLength) {
        return {
          isValid: false,
          error: `Maximum length is ${maxLength} characters`,
        };
      }
      return { isValid: true };
    }

    case "number": {
      const num = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(num) || !Number.isFinite(num)) {
        return { isValid: false, error: "Must be a valid number" };
      }
      if (block.integerOnly && !Number.isInteger(num)) {
        return { isValid: false, error: "Must be an integer" };
      }
      if (block.min !== undefined && num < block.min) {
        return { isValid: false, error: `Minimum value is ${block.min}` };
      }
      if (block.max !== undefined && num > block.max) {
        return { isValid: false, error: `Maximum value is ${block.max}` };
      }
      return { isValid: true };
    }

    case "single_choice": {
      if (typeof value !== "string" || !value.trim()) {
        return { isValid: false, error: "Please select an option" };
      }
      const validOptions = block.options.map((opt) => opt.value);
      if (value === "__OTHER__") {
        return { isValid: false, error: "Please specify the Other option" };
      }
      if (!validOptions.includes(value) && !block.allowOther) {
        return { isValid: false, error: "Selected option is not valid" };
      }
      return { isValid: true };
    }

    case "multiple_choice": {
      if (!Array.isArray(value)) {
        return { isValid: false, error: "Please select your options" };
      }
      const selected = value as string[];
      if (block.minSelections !== undefined && selected.length < block.minSelections) {
        return {
          isValid: false,
          error: `Please select at least ${block.minSelections} options`,
        };
      }
      if (block.maxSelections !== undefined && selected.length > block.maxSelections) {
        return {
          isValid: false,
          error: `You may select at most ${block.maxSelections} options`,
        };
      }
      const validOptions = new Set(block.options.map((opt) => opt.value));
      for (const item of selected) {
        if (!validOptions.has(item) && !block.allowOther) {
          return { isValid: false, error: `"${item}" is not a valid option` };
        }
      }
      return { isValid: true };
    }

    case "rating": {
      const rating = typeof value === "number" ? value : Number(value);
      const max = block.maxRating || 5;
      if (!Number.isInteger(rating) || rating < 1 || rating > max) {
        return {
          isValid: false,
          error: `Rating must be an integer between 1 and ${max}`,
        };
      }
      return { isValid: true };
    }

    case "linear_scale": {
      const scaleVal = typeof value === "number" ? value : Number(value);
      const min = block.min ?? 1;
      const max = block.max ?? 5;
      if (Number.isNaN(scaleVal) || scaleVal < min || scaleVal > max) {
        return {
          isValid: false,
          error: `Scale value must be between ${min} and ${max}`,
        };
      }
      if ((scaleVal - min) % block.step !== 0) {
        return {
          isValid: false,
          error: `Scale value must use increments of ${block.step}`,
        };
      }
      return { isValid: true };
    }

    case "date": {
      if (typeof value !== "string") {
        return { isValid: false, error: "Invalid date format" };
      }
      const parsedDate = parseStrictIsoDate(value);
      if (!parsedDate) {
        return {
          isValid: false,
          error: "Date must be a valid date in YYYY-MM-DD format",
        };
      }
      const minDate = block.minDate ? parseStrictIsoDate(block.minDate) : null;
      if (minDate && parsedDate.time < minDate.time) {
        return { isValid: false, error: `Date cannot be earlier than ${block.minDate}` };
      }
      const maxDate = block.maxDate ? parseStrictIsoDate(block.maxDate) : null;
      if (maxDate && parsedDate.time > isoDateUpperBound(maxDate)) {
        return { isValid: false, error: `Date cannot be later than ${block.maxDate}` };
      }
      return { isValid: true };
    }

    case "file_upload": {
      // Epic 5 review P3: an answer is a list of files. Real uploads carry the
      // server-issued `objectId` (FileAttachmentAnswer, Story 5.3); builder
      // previews carry a MockFileValue (`name`/`size`/`type`). A bare string
      // is never a file.
      if (typeof value === "string") {
        return { isValid: false, error: "Invalid file format" };
      }
      const files = Array.isArray(value) ? value : [value];
      if (files.length > block.maxFiles) {
        return {
          isValid: false,
          error: `You may upload at most ${block.maxFiles} files`,
        };
      }
      for (const file of files) {
        if (typeof file !== "object" || file === null || Array.isArray(file)) {
          return { isValid: false, error: "Invalid file format" };
        }
        let fileSize: unknown;
        let fileType: string | undefined;
        if ("objectId" in file) {
          const attachment = fileAttachmentAnswerSchema.safeParse(file);
          if (!attachment.success) {
            return { isValid: false, error: "Invalid file reference" };
          }
          fileSize = attachment.data.fileSize;
          fileType = attachment.data.mimeType;
        } else {
          const mockFile = file as MockFileValue;
          if (typeof mockFile.name !== "string" || !mockFile.name.trim()) {
            return { isValid: false, error: "Invalid file format" };
          }
          fileSize = mockFile.size;
          fileType = typeof mockFile.type === "string" ? mockFile.type : undefined;
        }
        if (typeof fileSize === "number" && block.maxFileSizeMb) {
          const maxBytes = block.maxFileSizeMb * 1024 * 1024;
          if (fileSize > maxBytes) {
            return {
              isValid: false,
              error: `File exceeds maximum size of ${block.maxFileSizeMb}MB`,
            };
          }
        }
        if (
          fileType &&
          block.allowedMimeTypes &&
          block.allowedMimeTypes.length > 0
        ) {
          const type = fileType;
          const isAllowed = block.allowedMimeTypes.some((allowed) => {
            if (allowed.endsWith("/*")) {
              const prefix = allowed.slice(0, -2);
              return type.startsWith(prefix);
            }
            return type === allowed;
          });
          if (!isAllowed) {
            return {
              isValid: false,
              error: `File type ${type} is not permitted. Allowed: ${block.allowedMimeTypes.join(", ")}`,
            };
          }
        }
      }
      return { isValid: true };
    }

    default:
      return { isValid: true };
  }
}

/**
 * Validate all answers in a form against the block definition list.
 */
export function validateAllAnswers(
  blocks: FormBlock[],
  answers: Record<string, unknown>
): FormAnswersValidationResult {
  const errors: Record<string, string> = {};
  let requiredCount = 0;
  let answeredCount = 0;

  for (const block of blocks) {
    if (block.required) {
      requiredCount++;
    }

    const value = answers[block.id];
    const isAnswered =
      value !== undefined &&
      value !== null &&
      value !== "" &&
      (!Array.isArray(value) || value.length > 0) &&
      (typeof value !== "string" || value.trim().length > 0);

    if (isAnswered) {
      answeredCount++;
    }

    const validation = validateBlockAnswer(block, value);
    if (!validation.isValid && validation.error) {
      errors[block.id] = validation.error;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    answeredCount,
    requiredCount,
  };
}

/**
 * Creates a mock FormSubmission conforming to formSubmissionSchema.
 * Strictly used in preview mode — never persisted.
 */
export function createMockSubmission(
  formId: string,
  formVersionId: string,
  answers: Record<string, unknown>
): FormSubmission {
  const blockAnswers: BlockAnswer[] = Object.entries(answers)
    .filter(
      ([, val]) =>
        val !== undefined &&
        val !== null &&
        val !== "" &&
        (!Array.isArray(val) || val.length > 0)
    )
    .map(([blockId, value]) => {
      let safeVal: BlockAnswer["value"] = null;
      if (typeof value === "string") safeVal = value;
      else if (typeof value === "number") safeVal = value;
      else if (typeof value === "boolean") safeVal = value;
      else if (Array.isArray(value)) {
        safeVal = value.map((item) =>
          typeof item === "string"
            ? item
            : typeof item === "object" && item !== null && "name" in item
              ? String(item.name)
              : String(item),
        );
      }
      else if (typeof value === "object" && value !== null && "name" in value) {
        safeVal = (value as { name: string }).name;
      }
      return { blockId, value: safeVal };
    });

  return {
    formId,
    formVersionId,
    answers: blockAnswers,
  };
}
