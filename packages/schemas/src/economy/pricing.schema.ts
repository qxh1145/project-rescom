import { z } from 'zod';
import type { FormTypeEnum } from '../forms/form-draft.schema';
import type { EscrowCostCalculationResult } from './escrow.schema';
import {
  computeInternalTimeBarrier,
  resolveExternalTimeBarrierSeconds,
} from '../participation/bot-protection';

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
 * The duration (whole minutes) the FR-14 band is picked from: the longest of
 * the Publisher's `estimatedDurationMinutes`, the declared
 * `metadata.expectedEffortSeconds` and the required minimum completion time
 * (the time barrier), rounded up. A survey whose effort or barrier is longer
 * than its claimed duration is priced for the longer time. Null without an
 * estimated duration (the band check then answers `DURATION_REQUIRED`).
 */
export function resolveEffectiveDurationMinutes(input: {
  estimatedDurationMinutes: number | null | undefined;
  expectedEffortSeconds?: number | null;
  requiredTimeBarrierSeconds?: number | null;
}): number | null {
  if (input.estimatedDurationMinutes == null) {
    return null;
  }
  const seconds = Math.max(
    input.estimatedDurationMinutes * 60,
    finiteSecondsOrZero(input.expectedEffortSeconds),
    finiteSecondsOrZero(input.requiredTimeBarrierSeconds),
  );
  return Math.ceil(seconds / 60);
}

function finiteSecondsOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/** The parts of a Form Definition the FR-14 duration options read. */
export interface RewardBandDefinitionLike {
  blocks?: ReadonlyArray<{ type?: unknown }> | null;
  metadata?: {
    expectedEffortSeconds?: number | null;
    minTimeBarrierSeconds?: number | null;
  } | null;
}

export interface RewardBandDurationOptions {
  expectedEffortSeconds: number | null;
  requiredTimeBarrierSeconds: number;
}

/**
 * The declared effort and required minimum completion time of a Form
 * Definition (Internal: `computeInternalTimeBarrier`; External: the
 * configured minimum or the default), which lengthen the FR-14 pricing
 * duration when they exceed the Publisher's `estimatedDurationMinutes`.
 * Shared by the backend publish check and the frontend hints, so both pick
 * the same band.
 */
export function resolveRewardBandDurationOptions(
  type: FormTypeEnum,
  definition: RewardBandDefinitionLike | null | undefined,
): RewardBandDurationOptions {
  return {
    expectedEffortSeconds: definition?.metadata?.expectedEffortSeconds ?? null,
    requiredTimeBarrierSeconds:
      type === 'EXTERNAL'
        ? resolveExternalTimeBarrierSeconds(definition?.metadata)
        : computeInternalTimeBarrier(definition).requiredSeconds,
  };
}

/** Default `metadata.expectedEffortSeconds` of a Form Definition. */
const DEFAULT_EXPECTED_EFFORT_SECONDS = 60;

/**
 * The `metadata.expectedEffortSeconds` an Internal Form Definition is stored
 * with (review F2): the stored value raised to at least the estimated
 * duration (when set) and the required minimum completion time
 * (`computeInternalTimeBarrier`), so a long survey never fails the
 * "effort >= barrier" rule only because the builder sent the default effort.
 * The value never goes down; it does not change the FR-14 effective duration.
 */
export function normalizeExpectedEffortSeconds(
  definition: RewardBandDefinitionLike | null | undefined,
  estimatedDurationMinutes: number | null | undefined,
): number {
  const stored = definition?.metadata?.expectedEffortSeconds;
  return Math.max(
    typeof stored === 'number' && Number.isFinite(stored)
      ? stored
      : DEFAULT_EXPECTED_EFFORT_SECONDS,
    typeof estimatedDurationMinutes === 'number' &&
      Number.isFinite(estimatedDurationMinutes)
      ? estimatedDurationMinutes * 60
      : 0,
    computeInternalTimeBarrier(definition).requiredSeconds,
  );
}

/**
 * The FR-14 band check a publication must pass (decision E6-D2). The band
 * minimum and maximum both apply; the absolute 10,000-point schema cap stays
 * the hard input limit for drafts. External surveys always pay at least 1
 * point, so only Internal surveys can be exempt. The band is picked from the
 * effective duration (`resolveEffectiveDurationMinutes`) when the declared
 * effort / required time barrier are given in `options`.
 *
 * `frozenReward` (review F3): the reward of a survey that already had a
 * published version cannot change (decision D2), so a re-versioned draft
 * whose longer questionnaire moved it to a higher band is not held to the
 * band minimum; the maximum still applies.
 */
export function checkPublishRewardBand(
  form: {
    type: FormTypeEnum;
    rewardPerResponse: number;
    estimatedDurationMinutes?: number | null;
  },
  options: {
    expectedEffortSeconds?: number | null;
    requiredTimeBarrierSeconds?: number | null;
    frozenReward?: boolean;
  } = {},
): PublishRewardBandCheck {
  if (form.type === 'INTERNAL' && form.rewardPerResponse === 0) {
    return { status: 'EXEMPT', range: null };
  }
  const durationMinutes = resolveEffectiveDurationMinutes({
    estimatedDurationMinutes: form.estimatedDurationMinutes,
    expectedEffortSeconds: options.expectedEffortSeconds,
    requiredTimeBarrierSeconds: options.requiredTimeBarrierSeconds,
  });
  if (durationMinutes === null) {
    return { status: 'DURATION_REQUIRED', range: null };
  }
  const range = getRewardPricingRange(durationMinutes);
  return (options.frozenReward || form.rewardPerResponse >= range.min) &&
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
