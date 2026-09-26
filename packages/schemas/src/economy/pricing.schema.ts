import { z } from 'zod';
import type { FormTypeEnum } from '../forms/form-draft.schema';
import type { EscrowCostCalculationResult } from './escrow.schema';

/**
 * Bounds of the Publisher's estimated completion time in whole minutes
 * (decision E6-D2): the FR-14 pricing band is picked from it at publish.
 */
export const ESTIMATED_DURATION_MIN_MINUTES = 1;
export const ESTIMATED_DURATION_MAX_MINUTES = 1440;

export const estimatedDurationMinutesSchema = z
  .number()
  .int('Estimated duration must be a whole number of minutes')
  .min(
    ESTIMATED_DURATION_MIN_MINUTES,
    'Estimated duration must be at least 1 minute',
  )
  .max(
    ESTIMATED_DURATION_MAX_MINUTES,
    'Estimated duration cannot exceed 1,440 minutes (24 hours)',
  );

export interface RewardPricingRange {
  min: number;
  max: number;
  suggested: number;
  durationBand: '< 5 min' | '5–10 min' | '10–15 min' | '> 15 min';
}

/**
 * Returns the permitted min/max points and suggested reward based on estimated duration in minutes (FR-14).
 * - < 5 min: 5–10 Points
 * - 5–10 min: 10–20 Points
 * - 10–15 min: 15–25 Points
 * - > 15 min: 20–40 Points
 */
export function getRewardPricingRange(durationMinutes: number): RewardPricingRange {
  if (durationMinutes < 5) {
    return {
      min: 5,
      max: 10,
      suggested: 5,
      durationBand: '< 5 min',
    };
  }
  if (durationMinutes <= 10) {
    return {
      min: 10,
      max: 20,
      suggested: 10,
      durationBand: '5–10 min',
    };
  }
  if (durationMinutes <= 15) {
    return {
      min: 15,
      max: 25,
      suggested: 15,
      durationBand: '10–15 min',
    };
  }
  return {
    min: 20,
    max: 40,
    suggested: 20,
    durationBand: '> 15 min',
  };
}

export interface ValidationPricingResult {
  isValid: boolean;
  error?: string;
  suggestedReward?: number;
  range?: RewardPricingRange;
}

/**
 * Validates a given reward per response against its estimated duration band (FR-14).
 */
export function validateRewardPricing(params: {
  durationMinutes: number;
  rewardPerResponse: number;
}): ValidationPricingResult {
  const range = getRewardPricingRange(params.durationMinutes);

  if (params.rewardPerResponse < range.min) {
    return {
      isValid: false,
      error: `Reward of ${params.rewardPerResponse} points is below minimum of ${range.min} points for surveys in the "${range.durationBand}" band. Suggested reward: ${range.suggested} points.`,
      suggestedReward: range.suggested,
      range,
    };
  }

  if (params.rewardPerResponse > range.max) {
    return {
      isValid: false,
      error: `Reward of ${params.rewardPerResponse} points exceeds maximum of ${range.max} points for surveys in the "${range.durationBand}" band.`,
      suggestedReward: range.suggested,
      range,
    };
  }

  return {
    isValid: true,
    suggestedReward: range.suggested,
    range,
  };
}

/**
 * Zod schema validating duration and reward according to pricing rules (FR-14).
 */
export const rewardPricingSchema = z
  .object({
    durationMinutes: z.number().positive(),
    rewardPerResponse: z.number().int().nonnegative(),
  })
  .superRefine((val, ctx) => {
    const result = validateRewardPricing(val);
    if (!result.isValid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rewardPerResponse'],
        message: result.error ?? 'Invalid reward per response',
      });
    }
  });

export type RewardPricingDto = z.infer<typeof rewardPricingSchema>;

/**
 * Outcome of the publish-time FR-14 band check (decision E6-D2):
 * - `EXEMPT`: a free (0-point) Internal survey — no band applies (6.3 AC3.1);
 * - `DURATION_REQUIRED`: a rewarded survey without an estimated duration;
 * - `OUT_OF_BAND` / `WITHIN_BAND`: the reward against the duration's band.
 * Drafts are never checked; only publication is.
 */
export type PublishRewardBandCheck =
  | { status: 'EXEMPT'; range: null }
  | { status: 'DURATION_REQUIRED'; range: null }
  | { status: 'OUT_OF_BAND'; range: RewardPricingRange }
  | { status: 'WITHIN_BAND'; range: RewardPricingRange };

export type PublishRewardBandStatus = PublishRewardBandCheck['status'];

/**
 * The FR-14 band check a publication must pass (decision E6-D2). The band
 * minimum and maximum both apply; the absolute 10,000-point schema cap stays
 * the hard input limit for drafts. External surveys always pay at least 1
 * point, so only Internal surveys can be exempt.
 */
export function checkPublishRewardBand(form: {
  type: FormTypeEnum;
  rewardPerResponse: number;
  estimatedDurationMinutes?: number | null;
}): PublishRewardBandCheck {
  if (form.type === 'INTERNAL' && form.rewardPerResponse === 0) {
    return { status: 'EXEMPT', range: null };
  }
  if (form.estimatedDurationMinutes == null) {
    return { status: 'DURATION_REQUIRED', range: null };
  }
  const range = getRewardPricingRange(form.estimatedDurationMinutes);
  return form.rewardPerResponse >= range.min &&
    form.rewardPerResponse <= range.max
    ? { status: 'WITHIN_BAND', range }
    : { status: 'OUT_OF_BAND', range };
}

/**
 * `GET /forms/:id/pricing-quote` (FR-14, FR-19): the Escrow cost plus the
 * pricing band of the form's estimated duration (decision E6-D2).
 */
export interface PricingQuoteDto extends EscrowCostCalculationResult {
  estimatedDurationMinutes: number | null;
  /** The FR-14 band of the estimated duration; null without a duration. */
  pricingBand: RewardPricingRange | null;
  /** What the publish-time band check would answer right now. */
  bandCheck: PublishRewardBandStatus;
}
