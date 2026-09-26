import {
  checkPublishRewardBand,
  normalizeExpectedEffortSeconds,
  resolveEffectiveDurationMinutes,
  resolveRewardBandDurationOptions,
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

  describe('resolveEffectiveDurationMinutes (FR-14 effective duration)', () => {
    it('is null without an estimated duration', () => {
      expect(
        resolveEffectiveDurationMinutes({
          estimatedDurationMinutes: null,
          expectedEffortSeconds: 1500,
          requiredTimeBarrierSeconds: 60,
        }),
      ).toBeNull();
      expect(
        resolveEffectiveDurationMinutes({ estimatedDurationMinutes: undefined }),
      ).toBeNull();
    });

    it('keeps the estimated duration when effort and barrier fit inside it', () => {
      expect(
        resolveEffectiveDurationMinutes({ estimatedDurationMinutes: 12 }),
      ).toBe(12);
      expect(
        resolveEffectiveDurationMinutes({
          estimatedDurationMinutes: 12,
          expectedEffortSeconds: 720,
          requiredTimeBarrierSeconds: 30,
        }),
      ).toBe(12);
    });

    it('uses the longest of estimate, expected effort and required barrier, rounded up', () => {
      expect(
        resolveEffectiveDurationMinutes({
          estimatedDurationMinutes: 1,
          expectedEffortSeconds: 1500,
        }),
      ).toBe(25);
      expect(
        resolveEffectiveDurationMinutes({
          estimatedDurationMinutes: 1,
          expectedEffortSeconds: 60,
          requiredTimeBarrierSeconds: 601,
        }),
      ).toBe(11);
      expect(
        resolveEffectiveDurationMinutes({
          estimatedDurationMinutes: 2,
          expectedEffortSeconds: 121,
          requiredTimeBarrierSeconds: null,
        }),
      ).toBe(3);
    });

    it('ignores non-finite or non-positive effort and barrier values', () => {
      expect(
        resolveEffectiveDurationMinutes({
          estimatedDurationMinutes: 4,
          expectedEffortSeconds: Number.NaN,
          requiredTimeBarrierSeconds: -600,
        }),
      ).toBe(4);
    });

    it('prices a 25-minute effort survey in the > 15 min band, not the claimed 1-minute band', () => {
      const claimed = {
        type: 'INTERNAL' as const,
        rewardPerResponse: 5,
        estimatedDurationMinutes: 1,
      };
      expect(checkPublishRewardBand(claimed).status).toBe('WITHIN_BAND');
      expect(
        checkPublishRewardBand(claimed, {
          expectedEffortSeconds: 1500,
          requiredTimeBarrierSeconds: 20,
        }),
      ).toEqual({ status: 'OUT_OF_BAND', range: getRewardPricingRange(25) });
      expect(
        checkPublishRewardBand(
          { ...claimed, rewardPerResponse: 20 },
          { expectedEffortSeconds: 1500 },
        ).status,
      ).toBe('WITHIN_BAND');
    });

    it('prices by the required time barrier when it exceeds the claimed duration', () => {
      expect(
        checkPublishRewardBand(
          { type: 'EXTERNAL', rewardPerResponse: 5, estimatedDurationMinutes: 1 },
          { requiredTimeBarrierSeconds: 360 },
        ),
      ).toEqual({ status: 'OUT_OF_BAND', range: getRewardPricingRange(6) });
    });

    it('still requires a duration and still exempts free Internal surveys', () => {
      expect(
        checkPublishRewardBand(
          { type: 'EXTERNAL', rewardPerResponse: 5, estimatedDurationMinutes: null },
          { expectedEffortSeconds: 1500 },
        ).status,
      ).toBe('DURATION_REQUIRED');
      expect(
        checkPublishRewardBand(
          { type: 'INTERNAL', rewardPerResponse: 0, estimatedDurationMinutes: 1 },
          { expectedEffortSeconds: 1500 },
        ).status,
      ).toBe('EXEMPT');
    });
  });

  describe('frozenReward (review F3)', () => {
    it('skips the band minimum but keeps the maximum', () => {
      const band = getRewardPricingRange(10);
      expect(
        checkPublishRewardBand(
          { type: 'INTERNAL', rewardPerResponse: 5, estimatedDurationMinutes: 4 },
          { expectedEffortSeconds: 600, frozenReward: true },
        ),
      ).toEqual({ status: 'WITHIN_BAND', range: band });
      expect(
        checkPublishRewardBand(
          { type: 'INTERNAL', rewardPerResponse: 5, estimatedDurationMinutes: 4 },
          { expectedEffortSeconds: 600 },
        ),
      ).toEqual({ status: 'OUT_OF_BAND', range: band });
      expect(
        checkPublishRewardBand(
          { type: 'INTERNAL', rewardPerResponse: 21, estimatedDurationMinutes: 4 },
          { expectedEffortSeconds: 600, frozenReward: true },
        ),
      ).toEqual({ status: 'OUT_OF_BAND', range: band });
    });

    it('still requires a duration', () => {
      expect(
        checkPublishRewardBand(
          { type: 'EXTERNAL', rewardPerResponse: 5, estimatedDurationMinutes: null },
          { frozenReward: true },
        ).status,
      ).toBe('DURATION_REQUIRED');
    });
  });

  describe('resolveRewardBandDurationOptions (review F5)', () => {
    const blocks = Array.from({ length: 31 }, () => ({ type: 'text' }));

    it('uses the Internal time barrier and the declared effort', () => {
      expect(
        resolveRewardBandDurationOptions('INTERNAL', {
          blocks,
          metadata: { expectedEffortSeconds: 90, minTimeBarrierSeconds: 15 },
        }),
      ).toEqual({ expectedEffortSeconds: 90, requiredTimeBarrierSeconds: 62 });
    });

    it('uses the External configured minimum or its default', () => {
      expect(
        resolveRewardBandDurationOptions('EXTERNAL', {
          metadata: { expectedEffortSeconds: 300, minTimeBarrierSeconds: 240 },
        }),
      ).toEqual({ expectedEffortSeconds: 300, requiredTimeBarrierSeconds: 240 });
      expect(resolveRewardBandDurationOptions('EXTERNAL', null)).toEqual({
        expectedEffortSeconds: null,
        requiredTimeBarrierSeconds: 15,
      });
    });

    it('lets the band follow the effective duration', () => {
      const options = resolveRewardBandDurationOptions('INTERNAL', {
        blocks,
        metadata: { expectedEffortSeconds: 600, minTimeBarrierSeconds: 15 },
      });
      expect(
        checkPublishRewardBand(
          { type: 'INTERNAL', rewardPerResponse: 5, estimatedDurationMinutes: 4 },
          options,
        ),
      ).toEqual({ status: 'OUT_OF_BAND', range: getRewardPricingRange(10) });
    });
  });

  describe('normalizeExpectedEffortSeconds (review F2)', () => {
    const blocks = (count: number) =>
      Array.from({ length: count }, () => ({ type: 'text' }));

    it('raises the default effort to the required barrier of a long survey', () => {
      expect(
        normalizeExpectedEffortSeconds(
          { blocks: blocks(31), metadata: { expectedEffortSeconds: 60 } },
          null,
        ),
      ).toBe(62);
    });

    it('raises the effort to the estimated duration', () => {
      expect(
        normalizeExpectedEffortSeconds(
          { blocks: blocks(3), metadata: { expectedEffortSeconds: 60 } },
          4,
        ),
      ).toBe(240);
    });

    it('never lowers the stored effort and defaults a missing one to 60 s', () => {
      expect(
        normalizeExpectedEffortSeconds(
          { blocks: blocks(3), metadata: { expectedEffortSeconds: 900 } },
          4,
        ),
      ).toBe(900);
      expect(normalizeExpectedEffortSeconds({ blocks: [] }, null)).toBe(60);
    });

    it('does not change the FR-14 effective duration', () => {
      const definition = {
        blocks: blocks(31),
        metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
      };
      const normalized = {
        ...definition,
        metadata: {
          ...definition.metadata,
          expectedEffortSeconds: normalizeExpectedEffortSeconds(definition, 4),
        },
      };
      expect(
        resolveEffectiveDurationMinutes({
          estimatedDurationMinutes: 4,
          ...resolveRewardBandDurationOptions('INTERNAL', normalized),
        }),
      ).toBe(
        resolveEffectiveDurationMinutes({
          estimatedDurationMinutes: 4,
          ...resolveRewardBandDurationOptions('INTERNAL', definition),
        }),
      );
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
