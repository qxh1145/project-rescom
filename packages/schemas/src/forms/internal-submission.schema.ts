import { z } from 'zod';
import { blockAnswerSchema, BlockAnswer } from './form-answer.schema';
import { FormBlock } from './form-blocks.schema';
import { validateAllAnswers } from './form-preview';
import {
  rewardPolicyModeSchema,
  RewardPolicyMode,
  rewardSettlementResultSchema,
  RewardSettlementResultDto,
} from '../economy/reward.schema';
import { securityEvidenceSchema } from '../participation/bot-protection';
import { fileAttachmentAnswerSchema } from '../storage/file-storage.schema';
import { clientContextSchema } from '../participation/survey-attempt.schema';

export const internalFormSubmissionInputSchema = z
  .object({
    attemptId: z.string().uuid().optional(),
    responseId: z.string().uuid().optional(),
    answers: z.union([
      z.array(blockAnswerSchema),
      z.record(z.unknown()),
    ]),
    clientContext: clientContextSchema.optional(),
  })
  .strict();

export type InternalFormSubmissionInput = z.infer<
  typeof internalFormSubmissionInputSchema
>;

export const internalFormSubmissionResponseSchema = z
  .object({
    responseId: z.string().uuid(),
    attemptId: z.string().uuid(),
    formId: z.string().uuid(),
    formVersionId: z.string().uuid(),
    status: z.literal('VALIDATED'),
    submittedAt: z.string().datetime(),
    reward: rewardSettlementResultSchema.nullable(),
    policyMode: rewardPolicyModeSchema,
  })
  .strict();

export type InternalFormSubmissionResponseDto = z.infer<
  typeof internalFormSubmissionResponseSchema
>;

export const internalRewardRequestedPayloadSchema = z
  .object({
    responseId: z.string().uuid(),
    attemptId: z.string().uuid(),
    formId: z.string().uuid(),
    formVersionId: z.string().uuid(),
    publisherId: z.string().uuid(),
    respondentId: z.string().uuid(),
    /**
     * The advertised reward the Respondent is credited in full (decision
     * E6-D1, option B). It is NOT the Escrow draw: the settlement journal
     * debits the Publisher's Escrow `internalRewardFunding(rewardAmount)
     * .escrowDraw` (= round(0.8 × reward), what publish reserved) and
     * SYSTEM_ISSUANCE the remaining `platformSubsidy`.
     */
    rewardAmount: z.number().int().positive(),
    policyMode: rewardPolicyModeSchema,
    policyDeploymentId: z.string().min(1),
    submittedAt: z.string().datetime(),
  })
  .strict();

export type InternalRewardRequestedPayload = z.infer<
  typeof internalRewardRequestedPayloadSchema
>;

export const integrityAssessmentRequestedPayloadSchema = z
  .object({
    responseId: z.string().uuid(),
    attemptId: z.string().uuid(),
    formId: z.string().uuid(),
    formVersionId: z.string().uuid(),
    respondentId: z.string().uuid().nullable(),
    policyMode: rewardPolicyModeSchema,
    policyDeploymentId: z.string().min(1),
    answers: z.union([z.record(z.unknown()), z.array(z.unknown())]),
    submittedAt: z.string().datetime(),
    /** Story 8.2: hard-control evidence (Time Barrier) for the Integrity Engine. */
    securityEvidence: securityEvidenceSchema.optional(),
  })
  .strict();

export type IntegrityAssessmentRequestedPayload = z.infer<
  typeof integrityAssessmentRequestedPayloadSchema
>;

export interface AnswersValidationOutcome {
  isValid: boolean;
  errors: Record<string, string>;
  normalizedAnswers: Record<string, unknown>;
  answeredCount: number;
  requiredCount: number;
}

/**
 * Validates submitted answers against the immutable FormVersion block definitions.
 * Normalizes input (array of BlockAnswer or key-value map) into a record,
 * checks for unknown block IDs, checks for duplicates, and verifies all block-type constraints.
 */
export function validateAnswersAgainstFormDefinition(
  blocks: FormBlock[],
  answers: Record<string, unknown> | BlockAnswer[],
): AnswersValidationOutcome {
  const normalizedAnswers: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const validBlockIds = new Set(blocks.map((b) => b.id));

  if (Array.isArray(answers)) {
    const seenBlockIds = new Set<string>();
    for (const item of answers) {
      if (seenBlockIds.has(item.blockId)) {
        errors[item.blockId] = `Duplicate block ID: "${item.blockId}"`;
      }
      seenBlockIds.add(item.blockId);
      normalizedAnswers[item.blockId] = item.value;
    }
  } else if (typeof answers === 'object' && answers !== null) {
    Object.assign(normalizedAnswers, answers);
  }

  // Check for unrecognized/unknown block IDs submitted
  for (const blockId of Object.keys(normalizedAnswers)) {
    if (!validBlockIds.has(blockId)) {
      errors[blockId] = `Unrecognized block ID: "${blockId}" does not exist in form definition`;
    }
  }

  // Validate answer constraints using preview validator
  const blockValidation = validateAllAnswers(blocks, normalizedAnswers);
  Object.assign(errors, blockValidation.errors);

  // Epic 5 review P3/P23: strict server-only pass (AC1.3 "conform strictly").
  // The preview validator above stays lenient for the builder and renderer.
  for (const block of blocks) {
    const value = normalizedAnswers[block.id];
    if (errors[block.id] || !isAnswerProvided(value)) {
      continue;
    }
    const strict = strictAnswerCheck(block, value);
    if (strict.error) {
      errors[block.id] = strict.error;
    } else if (strict.normalized !== undefined) {
      normalizedAnswers[block.id] = strict.normalized;
    }
  }

  const isValid = Object.keys(errors).length === 0;

  return {
    isValid,
    errors,
    normalizedAnswers,
    answeredCount: blockValidation.answeredCount,
    requiredCount: blockValidation.requiredCount,
  };
}

/** Max length of a free-text "Other" choice (Epic 5 review P23). */
export const OTHER_CHOICE_MAX_LENGTH = 500;

function isAnswerProvided(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    value !== '' &&
    (!Array.isArray(value) || value.length > 0) &&
    (typeof value !== 'string' || value.trim().length > 0)
  );
}

/**
 * Epic 5 review P3/P23: server-side type strictness on top of the lenient
 * preview rules — no numeric coercion, unique string choices, a bounded
 * "Other" value, and file answers that are real attachment references.
 */
function strictAnswerCheck(
  block: FormBlock,
  value: unknown,
): { error?: string; normalized?: unknown } {
  switch (block.type) {
    case 'number':
    case 'rating':
    case 'linear_scale':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { error: 'Answer must be a number' };
      }
      return {};

    case 'single_choice': {
      if (typeof value !== 'string') {
        return { error: 'Please select an option' };
      }
      const isOption = block.options.some((option) => option.value === value);
      if (!isOption && value.trim().length > OTHER_CHOICE_MAX_LENGTH) {
        return {
          error: `"Other" answer must not exceed ${OTHER_CHOICE_MAX_LENGTH} characters`,
        };
      }
      return {};
    }

    case 'multiple_choice': {
      if (
        !Array.isArray(value) ||
        !value.every((item) => typeof item === 'string')
      ) {
        return { error: 'Selected options must be text values' };
      }
      const items = value as string[];
      if (new Set(items).size !== items.length) {
        return { error: 'Each option may be selected only once' };
      }
      const optionValues = new Set(block.options.map((option) => option.value));
      const others = items.filter((item) => !optionValues.has(item));
      if (others.length > 0) {
        if (!block.allowOther || others.length > 1) {
          return { error: 'At most one "Other" answer is allowed' };
        }
        const other = others[0].trim();
        if (!other || other.length > OTHER_CHOICE_MAX_LENGTH) {
          return {
            error: `"Other" answer must be 1-${OTHER_CHOICE_MAX_LENGTH} characters`,
          };
        }
      }
      return {};
    }

    case 'file_upload': {
      const parsed = z
        .array(fileAttachmentAnswerSchema)
        .max(block.maxFiles)
        .safeParse(value);
      if (!parsed.success) {
        return { error: 'Invalid file reference' };
      }
      return { normalized: parsed.data };
    }

    default:
      return {};
  }
}
