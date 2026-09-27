import {
  marketplaceFeedQuerySchema,
  marketplaceSurveyCardSchema,
  MarketplaceSortOption,
} from '@rescom/schemas';

describe('Story 4.3: Marketplace Feed Interaction Schemas', () => {
  describe('marketplaceFeedQuerySchema', () => {
    it('should set default values for empty query', () => {
      const parsed = marketplaceFeedQuerySchema.parse({});
      expect(parsed.sortBy).toBe('best_match');
      expect(parsed.hideCompleted).toBe(true);
      expect(parsed.type).toBe('ALL');
      expect(parsed.search).toBeUndefined();
      expect(parsed.minReward).toBeUndefined();
      expect(parsed.maxDuration).toBeUndefined();
    });

    it('should accept valid sort options', () => {
      const validSorts: MarketplaceSortOption[] = [
        'best_match',
        'reward_desc',
        'reward_asc',
        'duration_asc',
        'duration_desc',
        'newest',
      ];
      for (const sort of validSorts) {
        const parsed = marketplaceFeedQuerySchema.parse({ sortBy: sort });
        expect(parsed.sortBy).toBe(sort);
      }
    });

    it('should normalize sort aliases', () => {
      expect(
        marketplaceFeedQuerySchema.parse({ sortBy: 'reward' }).sortBy,
      ).toBe('reward_desc');
      expect(
        marketplaceFeedQuerySchema.parse({ sortBy: 'duration' }).sortBy,
      ).toBe('duration_asc');
    });

    it('should coerce string booleans for hideCompleted', () => {
      expect(
        marketplaceFeedQuerySchema.parse({ hideCompleted: 'false' })
          .hideCompleted,
      ).toBe(false);
      expect(
        marketplaceFeedQuerySchema.parse({ hideCompleted: '0' }).hideCompleted,
      ).toBe(false);
      expect(
        marketplaceFeedQuerySchema.parse({ hideCompleted: 'true' })
          .hideCompleted,
      ).toBe(true);
      expect(
        marketplaceFeedQuerySchema.parse({ hideCompleted: '1' }).hideCompleted,
      ).toBe(true);
    });

    it('should trim search string and enforce max length', () => {
      const parsed = marketplaceFeedQuerySchema.parse({
        search: '   technology survey   ',
      });
      expect(parsed.search).toBe('technology survey');

      expect(() =>
        marketplaceFeedQuerySchema.parse({ search: 'a'.repeat(101) }),
      ).toThrow();
    });

    it('should coerce numeric query parameters', () => {
      const parsed = marketplaceFeedQuerySchema.parse({
        minReward: '50',
        maxDuration: '300',
      });
      expect(parsed.minReward).toBe(50);
      expect(parsed.maxDuration).toBe(300);
    });

    it('treats empty or whitespace-only numeric parameters as not set', () => {
      for (const blank of ['', ' ', '\t  ']) {
        const parsed = marketplaceFeedQuerySchema.parse({
          minReward: blank,
          maxDuration: blank,
        });
        expect(parsed.minReward).toBeUndefined();
        expect(parsed.maxDuration).toBeUndefined();
      }
    });

    it('accepts only plain decimal digits for numeric parameters', () => {
      expect(
        marketplaceFeedQuerySchema.parse({
          minReward: ' 7 ',
          maxDuration: '60',
        }),
      ).toMatchObject({ minReward: 7, maxDuration: 60 });
      for (const bad of ['1e3', '0x10', '-5', '1.5', '12abc', 'Infinity']) {
        expect(
          marketplaceFeedQuerySchema.safeParse({ minReward: bad }).success,
        ).toBe(false);
        expect(
          marketplaceFeedQuerySchema.safeParse({ maxDuration: bad }).success,
        ).toBe(false);
      }
    });

    it('caps minReward at 10,000 points and maxDuration at 86,400 seconds', () => {
      expect(
        marketplaceFeedQuerySchema.parse({
          minReward: '10000',
          maxDuration: '86400',
        }),
      ).toMatchObject({ minReward: 10_000, maxDuration: 86_400 });
      expect(
        marketplaceFeedQuerySchema.safeParse({ minReward: '10001' }).success,
      ).toBe(false);
      expect(
        marketplaceFeedQuerySchema.safeParse({ maxDuration: '86401' }).success,
      ).toBe(false);
      expect(
        marketplaceFeedQuerySchema.safeParse({ maxDuration: '1'.repeat(25) })
          .success,
      ).toBe(false);
    });

    it('should validate survey type filter', () => {
      expect(marketplaceFeedQuerySchema.parse({ type: 'INTERNAL' }).type).toBe(
        'INTERNAL',
      );
      expect(marketplaceFeedQuerySchema.parse({ type: 'EXTERNAL' }).type).toBe(
        'EXTERNAL',
      );
      expect(() =>
        marketplaceFeedQuerySchema.parse({ type: 'INVALID' }),
      ).toThrow();
    });
  });

  describe('marketplaceSurveyCardSchema with Story 4.3 fields', () => {
    const baseCard = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Customer Experience Survey',
      description: 'Test description',
      type: 'INTERNAL',
      status: 'PUBLISHED',
      rewardPerResponse: 20,
      expectedCompletions: 100,
      estimatedEffortSeconds: 120,
      versionNumber: 1,
      publishedAt: '2026-09-15T00:00:00.000Z',
      targetingJson: null,
      hasTargeting: false,
    };

    it('should default isCompletedByCurrentUser to false and completedCompletions to 0', () => {
      const parsed = marketplaceSurveyCardSchema.parse(baseCard);
      expect(parsed.isCompletedByCurrentUser).toBe(false);
      expect(parsed.completedCompletions).toBe(0);
    });

    it('should accept custom isCompletedByCurrentUser and completedCompletions', () => {
      const parsed = marketplaceSurveyCardSchema.parse({
        ...baseCard,
        isCompletedByCurrentUser: true,
        completedCompletions: 42,
      });
      expect(parsed.isCompletedByCurrentUser).toBe(true);
      expect(parsed.completedCompletions).toBe(42);
    });
  });
});
