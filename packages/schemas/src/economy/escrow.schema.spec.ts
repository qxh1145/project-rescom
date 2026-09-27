import {
  calculateEscrowCost,
  escrowCostCalculationSchema,
  reopenSurveySchema,
  escrowDrawPerCompletion,
  internalRewardFunding,
  MAX_EXPECTED_COMPLETIONS,
} from './escrow.schema';

describe('Escrow Cost Calculation & Survey Reopen Schemas (FR-15, FR-19, FR-33)', () => {
  describe('calculateEscrowCost', () => {
    it('calculates escrow without discount for external forms (FR-15)', () => {
      const calculation = calculateEscrowCost({
        type: 'EXTERNAL',
        expectedCompletions: 100,
        rewardPerResponse: 10,
      });

      expect(calculation).toEqual({
        type: 'EXTERNAL',
        expectedCompletions: 100,
        baseRewardPerResponse: 10,
        effectiveRewardPerResponse: 10,
        baseCost: 1000,
        effectiveCost: 1000,
        discountPercent: 0,
        discountAmount: 0,
      });
    });

    it('applies 20% discount for internal forms (FR-19)', () => {
      const calculation = calculateEscrowCost({
        type: 'INTERNAL',
        expectedCompletions: 50,
        rewardPerResponse: 10, // 20% discount -> 8 points
      });

      expect(calculation).toEqual({
        type: 'INTERNAL',
        expectedCompletions: 50,
        baseRewardPerResponse: 10,
        effectiveRewardPerResponse: 8,
        baseCost: 500,
        effectiveCost: 400,
        discountPercent: 20,
        discountAmount: 100,
      });
    });

    it('correctly rounds effective reward per response with 20% discount', () => {
      const calculation = calculateEscrowCost({
        type: 'INTERNAL',
        expectedCompletions: 10,
        rewardPerResponse: 7, // 7 * 0.8 = 5.6 -> rounded to 6
      });

      expect(calculation.effectiveRewardPerResponse).toBe(6);
      expect(calculation.effectiveCost).toBe(60);
      expect(calculation.baseCost).toBe(70);
      expect(calculation.discountAmount).toBe(10);
    });

    it('handles 0 point reward without negative or divide-by-zero errors', () => {
      const calculation = calculateEscrowCost({
        type: 'INTERNAL',
        expectedCompletions: 25,
        rewardPerResponse: 0,
      });

      expect(calculation.effectiveCost).toBe(0);
      expect(calculation.discountAmount).toBe(0);
    });
  });

  describe('escrowCostCalculationSchema', () => {
    it('validates a valid escrow calculation object', () => {
      const valid = {
        type: 'INTERNAL',
        expectedCompletions: 100,
        baseRewardPerResponse: 15,
        effectiveRewardPerResponse: 12,
        baseCost: 1500,
        effectiveCost: 1200,
        discountPercent: 20,
        discountAmount: 300,
      };

      const parsed = escrowCostCalculationSchema.parse(valid);
      expect(parsed).toEqual(valid);
    });
  });

  describe('reopenSurveySchema (FR-33)', () => {
    it('accepts valid positive additionalCompletions', () => {
      const parsed = reopenSurveySchema.parse({
        additionalCompletions: 50,
      });
      expect(parsed.additionalCompletions).toBe(50);
    });

    it('rejects 0 or negative additionalCompletions', () => {
      expect(() =>
        reopenSurveySchema.parse({
          additionalCompletions: 0,
        }),
      ).toThrow();

      expect(() =>
        reopenSurveySchema.parse({
          additionalCompletions: -10,
        }),
      ).toThrow();
    });

    it('caps additionalCompletions at the 100,000 creation cap (Epic 6 review P12)', () => {
      expect(
        reopenSurveySchema.safeParse({
          additionalCompletions: MAX_EXPECTED_COMPLETIONS,
        }).success,
      ).toBe(true);
      expect(
        reopenSurveySchema.safeParse({
          additionalCompletions: MAX_EXPECTED_COMPLETIONS + 1,
        }).success,
      ).toBe(false);
    });
  });

  describe('escrowDrawPerCompletion (Epic 6 review P4, decision D1)', () => {
    it('draws the effective (discounted) reward for Internal forms', () => {
      expect(
        escrowDrawPerCompletion({ type: 'INTERNAL', rewardPerResponse: 10 }),
      ).toBe(8);
      expect(
        escrowDrawPerCompletion({ type: 'INTERNAL', rewardPerResponse: 7 }),
      ).toBe(6);
    });

    it('draws the full reward for External forms and 0 for free surveys', () => {
      expect(
        escrowDrawPerCompletion({ type: 'EXTERNAL', rewardPerResponse: 20 }),
      ).toBe(20);
      expect(
        escrowDrawPerCompletion({ type: 'INTERNAL', rewardPerResponse: 0 }),
      ).toBe(0);
    });
  });

  describe('internalRewardFunding (decision E6-D1, option B)', () => {
    it('credits the full reward: Escrow pays the reserved 80%, the platform mints the rest', () => {
      expect(internalRewardFunding(25)).toEqual({
        respondentCredit: 25,
        escrowDraw: 20,
        platformSubsidy: 5,
      });
      expect(internalRewardFunding(7)).toEqual({
        respondentCredit: 7,
        escrowDraw: 6,
        platformSubsidy: 1,
      });
    });

    it('draws exactly what publish reserved per slot, so the subsidy is 0 when rounding absorbs the discount', () => {
      for (const reward of [1, 2, 3, 10, 13, 40, 9999]) {
        const funding = internalRewardFunding(reward);
        expect(funding.escrowDraw).toBe(
          escrowDrawPerCompletion({ type: 'INTERNAL', rewardPerResponse: reward }),
        );
        expect(funding.escrowDraw + funding.platformSubsidy).toBe(reward);
        expect(funding.platformSubsidy).toBeGreaterThanOrEqual(0);
      }
      expect(internalRewardFunding(2).platformSubsidy).toBe(0);
    });
  });
});
