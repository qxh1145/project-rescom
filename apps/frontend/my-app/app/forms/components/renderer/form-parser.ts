import {
  parseFormDefinitionDraft,
  validateBlockAnswer,
  validateAllAnswers,
  createMockSubmission,
  type AnswerValidationResult,
  type FormAnswersValidationResult,
  type MockFileValue,
} from "@rescom/schemas";
import type { FormBlock } from "@rescom/schemas";

export {
  parseFormDefinitionDraft,
  validateBlockAnswer,
  validateAllAnswers,
  createMockSubmission,
  type AnswerValidationResult,
  type FormAnswersValidationResult,
  type MockFileValue,
};

export interface FormProgress {
  answeredCount: number;
  totalQuestions: number;
  requiredAnsweredCount: number;
  totalRequired: number;
  percentage: number;
}

export function calculateFormProgress(
  blocks: FormBlock[],
  answers: Record<string, unknown>
): FormProgress {
  let totalRequired = 0;
  let requiredAnsweredCount = 0;
  let answeredCount = 0;

  for (const block of blocks) {
    if (block.required) {
      totalRequired++;
    }

    const val = answers[block.id];
    const isAnswered =
      val !== undefined &&
      val !== null &&
      val !== "" &&
      (!Array.isArray(val) || val.length > 0) &&
      (typeof val !== "string" || val.trim().length > 0);

    if (isAnswered) {
      answeredCount++;
      if (block.required) {
        requiredAnsweredCount++;
      }
    }
  }

  const denominator = totalRequired > 0 ? totalRequired : blocks.length;
  const numerator = totalRequired > 0 ? requiredAnsweredCount : answeredCount;
  const percentage = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;

  return {
    answeredCount,
    totalQuestions: blocks.length,
    requiredAnsweredCount,
    totalRequired,
    percentage,
  };
}
