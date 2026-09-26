import {
  checkPublishRewardBand,
  estimatedDurationMinutesSchema,
  getRewardPricingRange,
  validateRewardPricing,
  rewardPricingSchema,
} from './pricing.schema';
import { createFormDraftSchema, updateFormDraftSchema } from '../forms/form-draft.schema';
import { createExternalSurveySchema } from '../forms/external-form.schema';
import { publishFormSchema } from '../forms/form-publish.schema';

describe('Pricing Table & Reward Validation (FR-14)', () => {
  describe('getRewardPricingRange', () => {
    it('returns 5–10 points for < 5 minutes', () => {
      const range = getRewardPricingRange(3);
      expect(range).toEqual({
        min: 5,
        max: 10,
        suggested: 5,
        durationBand: '< 5 min',
      });
    });

    it('returns 10–20 points for 5–10 minutes (inclusive)', () => {
      expect(getRewardPricingRange(5)).toEqual({
        min: 10,
        max: 20,
        suggested: 10,
        durationBand: '5–10 min',
      });
      expect(getRewardPricingRange(10)).toEqual({
        min: 10,
        max: 20,
        suggested: 10,
        durationBand: '5–10 min',
      });
    });

    it('returns 15–25 points for 10–15 minutes', () => {
      expect(getRewardPricingRange(12)).toEqual({
        min: 15,
        max: 25,
        suggested: 15,
        durationBand: '10–15 min',
      });
      expect(getRewardPricingRange(15)).toEqual({
        min: 15,
        max: 25,
        suggested: 15,
        durationBand: '10–15 min',
      });
    });

    it('returns 20–40 points for > 15 minutes', () => {
      expect(getRewardPricingRange(16)).toEqual({
        min: 20,
        max: 40,
        suggested: 20,
        durationBand: '> 15 min',
      });
      expect(getRewardPricingRange(30)).toEqual({
        min: 20,
        max: 40,
        suggested: 20,
        durationBand: '> 15 min',
      });
    });
  });

  describe('validateRewardPricing', () => {
    it('accepts reward within valid range', () => {
      const result = validateRewardPricing({
        durationMinutes: 4,
        rewardPerResponse: 7,
      });
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects reward below minimum and suggests valid minimum', () => {
      const result = validateRewardPricing({
        durationMinutes: 8,
        rewardPerResponse: 4, // min is 10
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/below minimum/i);
      expect(result.suggestedReward).toBe(10);
      expect(result.range?.min).toBe(10);
    });

    it('rejects reward above maximum', () => {
      const result = validateRewardPricing({
        durationMinutes: 4,
        rewardPerResponse: 15, // max is 10
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/exceeds maximum/i);
    });
  });

  describe('rewardPricingSchema', () => {
    it('validates a correct pricing input', () => {
      const parsed = rewardPricingSchema.parse({
        durationMinutes: 8,
        rewardPerResponse: 15,
      });
      expect(parsed.rewardPerResponse).toBe(15);
    });

    it('throws error when reward is below band minimum', () => {
      expect(() =>
        rewardPricingSchema.parse({
          durationMinutes: 12,
          rewardPerResponse: 10, // min is 15
        }),
      ).toThrow(/below minimum/i);
    });
  });

  describe('checkPublishRewardBand (decision E6-D2)', () => {
    it('exempts free (0-point) Internal surveys from the band (6.3 AC3.1)', () => {
      expect(
        checkPublishRewardBand({
          type: 'INTERNAL',
          rewardPerResponse: 0,
          estimatedDurationMinutes: null,
        }),
      ).toEqual({ status: 'EXEMPT', range: null });
      expect(
        checkPublishRewardBand({
          type: 'INTERNAL',
          rewardPerResponse: 0,
          estimatedDurationMinutes: 30,
        }).status,
      ).toBe('EXEMPT');
    });

    it('requires a duration for rewarded Internal and every External survey', () => {
      expect(
        checkPublishRewardBand({ type: 'INTERNAL', rewardPerResponse: 10 }),
      ).toEqual({ status: 'DURATION_REQUIRED', range: null });
      expect(
        checkPublishRewardBand({
          type: 'EXTERNAL',
          rewardPerResponse: 10,
          estimatedDurationMinutes: null,
        }).status,
      ).toBe('DURATION_REQUIRED');
    });

    it('enforces both the band minimum and the band maximum', () => {
      const band = getRewardPricingRange(12);
      expect(
        checkPublishRewardBand({
          type: 'INTERNAL',
          rewardPerResponse: 14,
          estimatedDurationMinutes: 12,
        }),
      ).toEqual({ status: 'OUT_OF_BAND', range: band });
      expect(
        checkPublishRewardBand({
          type: 'EXTERNAL',
          rewardPerResponse: 26,
          estimatedDurationMinutes: 12,
        }),
      ).toEqual({ status: 'OUT_OF_BAND', range: band });
      for (const reward of [15, 20, 25]) {
        expect(
          checkPublishRewardBand({
            type: 'EXTERNAL',
            rewardPerResponse: reward,
            estimatedDurationMinutes: 12,
          }),
        ).toEqual({ status: 'WITHIN_BAND', range: band });
      }
    });

    it('applies the > 15 min maximum (40) to large rewards that the 10,000 draft cap allows', () => {
      expect(
        checkPublishRewardBand({
          type: 'EXTERNAL',
          rewardPerResponse: 41,
          estimatedDurationMinutes: 60,
        }).status,
      ).toBe('OUT_OF_BAND');
      expect(
        checkPublishRewardBand({
          type: 'EXTERNAL',
          rewardPerResponse: 40,
          estimatedDurationMinutes: 60,
        }).status,
      ).toBe('WITHIN_BAND');
    });
  });

  describe('estimatedDurationMinutes on the form schemas (decision E6-D2)', () => {
    it('accepts whole minutes from 1 to 1,440 only', () => {
      expect(estimatedDurationMinutesSchema.parse(1)).toBe(1);
      expect(estimatedDurationMinutesSchema.parse(1440)).toBe(1440);
      for (const bad of [0, -1, 1.5, 1441]) {
        expect(estimatedDurationMinutesSchema.safeParse(bad).success).toBe(
          false,
        );
      }
    });

    it('is optional and nullable on drafts, which stay editable out of band', () => {
      expect(createFormDraftSchema.parse({}).estimatedDurationMinutes).toBe(
        undefined,
      );
      expect(
        createFormDraftSchema.parse({
          rewardPerResponse: 9000,
          estimatedDurationMinutes: 3,
        }).estimatedDurationMinutes,
      ).toBe(3);
      const update = updateFormDraftSchema.parse({
        clientUpdatedAt: '2026-09-26T12:00:00.000Z',
        estimatedDurationMinutes: null,
      });
      expect(update.estimatedDurationMinutes).toBeNull();
      expect(
        updateFormDraftSchema.safeParse({
          clientUpdatedAt: '2026-09-26T12:00:00.000Z',
          estimatedDurationMinutes: 0,
        }).success,
      ).toBe(false);
    });

    it('is accepted by the External survey and publish schemas', () => {
      const external = createExternalSurveySchema.parse({
        title: 'External',
        externalUrl: 'https://forms.gle/abc',
        estimatedDurationMinutes: 8,
      });
      expect(external.estimatedDurationMinutes).toBe(8);
      expect(
        publishFormSchema.parse({ estimatedDurationMinutes: 12 })
          .estimatedDurationMinutes,
      ).toBe(12);
      expect(
        publishFormSchema.safeParse({ estimatedDurationMinutes: 2000 })
          .success,
      ).toBe(false);
    });
  });
});
