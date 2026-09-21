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
