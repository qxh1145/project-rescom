import { z } from 'zod';
import { formTypeEnum, FormTypeEnum } from '../forms/form-draft.schema';
import { formDeadlineAtSchema } from '../forms/form-topic.schema';

export interface EscrowCostCalculationInput {
  type: FormTypeEnum;
  expectedCompletions: number;
  rewardPerResponse: number;
}

export interface EscrowCostCalculationResult {
  type: FormTypeEnum;
  expectedCompletions: number;
  baseRewardPerResponse: number;
  effectiveRewardPerResponse: number;
  baseCost: number;
  effectiveCost: number;
  discountPercent: number;
  discountAmount: number;
}

/**
 * Calculates total escrow cost applying a 20% discount for Internal Forms (FR-15, FR-19).
 */
export function calculateEscrowCost(
  input: EscrowCostCalculationInput,
): EscrowCostCalculationResult {
  const isInternal = input.type === 'INTERNAL';
  const discountPercent = isInternal ? 20 : 0;

  // 20% discount on cost per response for internal forms
  const effectiveRewardPerResponse = isInternal
    ? Math.round(input.rewardPerResponse * 0.8)
    : input.rewardPerResponse;

  const baseCost = input.expectedCompletions * input.rewardPerResponse;
  const effectiveCost = input.expectedCompletions * effectiveRewardPerResponse;
  const discountAmount = Math.max(0, baseCost - effectiveCost);

  return {
    type: input.type,
    expectedCompletions: input.expectedCompletions,
    baseRewardPerResponse: input.rewardPerResponse,
    effectiveRewardPerResponse,
    baseCost,
    effectiveCost,
    discountPercent,
    discountAmount,
  };
}

/**
 * Points one completion draws from the form's Escrow (Epic 6 review P4):
 * exactly what publication reserved per slot, `effectiveRewardPerResponse`.
 * Escrow reservations, close refunds, re-publication shortfalls, reopen
 * locks and the Internal payout (`internalRewardFunding`) all use this
 * single helper, so paying 100% of a quota leaves the form's Escrow at 0.
 */
export function escrowDrawPerCompletion(form: {
  type: FormTypeEnum;
  rewardPerResponse: number;
}): number {
  return calculateEscrowCost({
    type: form.type,
    expectedCompletions: 1,
    rewardPerResponse: form.rewardPerResponse,
  }).effectiveRewardPerResponse;
}

export interface InternalRewardFunding {
  /** Points the Respondent receives: the advertised `rewardPerResponse`. */
  respondentCredit: number;
  /** Drawn from the Publisher's Escrow (`escrowDrawPerCompletion`). */
  escrowDraw: number;
  /** Minted from SYSTEM_ISSUANCE: the FR-19 Internal discount. */
  platformSubsidy: number;
}

/**
 * Decision E6-D1 (option B, platform subsidy, 2026-09-26): an Internal payout
 * credits the full advertised reward. The Publisher's Escrow pays the
 * discounted `round(0.8 × reward)` it reserved at publish and SYSTEM_ISSUANCE
 * mints the rest (points are not redeemable for cash, FR-34), all in one
 * balanced journal.
 */
export function internalRewardFunding(
  rewardPerResponse: number,
): InternalRewardFunding {
  const escrowDraw = escrowDrawPerCompletion({
    type: 'INTERNAL',
    rewardPerResponse,
  });
  return {
    respondentCredit: rewardPerResponse,
    escrowDraw,
    platformSubsidy: rewardPerResponse - escrowDraw,
  };
}

/** FR-13 creation cap, also enforced for reopen totals (Epic 6 review P12). */
export const MAX_EXPECTED_COMPLETIONS = 100_000;

export const escrowCostCalculationSchema = z.object({
  type: formTypeEnum,
  expectedCompletions: z.number().int().nonnegative(),
  baseRewardPerResponse: z.number().int().nonnegative(),
  effectiveRewardPerResponse: z.number().int().nonnegative(),
  baseCost: z.number().int().nonnegative(),
  effectiveCost: z.number().int().nonnegative(),
  discountPercent: z.number().nonnegative(),
  discountAmount: z.number().int().nonnegative(),
});

export type EscrowCostCalculationDto = z.infer<typeof escrowCostCalculationSchema>;

/**
 * Schema for reopening a closed survey with additional sample quota (FR-33).
 */
export const reopenSurveySchema = z.object({
  additionalCompletions: z
    .number()
    .int('Additional completions must be an integer')
    .positive('Additional completions must be greater than zero')
    .max(
      MAX_EXPECTED_COMPLETIONS,
      'Additional completions cannot exceed 100,000',
    ),
  /**
   * Story IR.2b Q3: the new collection deadline (1 h – 180 d ahead) or null
   * for none. Required when the survey's deadline has passed (a DEADLINE
   * close, or an owner close after the deadline): otherwise the deadline job
   * would close it again at once. Omitted = keep the current deadline.
   */
  deadlineAt: formDeadlineAtSchema.optional().nullable(),
});

export type ReopenSurveyDto = z.infer<typeof reopenSurveySchema>;
export type ReopenSurveyInput = z.input<typeof reopenSurveySchema>;
