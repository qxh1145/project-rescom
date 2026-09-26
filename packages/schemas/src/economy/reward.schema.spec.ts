import {
  creditInternalRewardSchema,
  creditPendingRewardSchema,
  releasePendingRewardSchema,
  releasePendingRewardRequestSchema,
  releaseMaturedPendingRewardsSchema,
  rewardRedriveRequestSchema,
  disputeHoldSchema,
  resolveDisputeHoldSchema,
  rewardSettlementResultSchema,
  CreditInternalRewardInput,
  CreditPendingRewardInput,
  ReleasePendingRewardInput,
  DisputeHoldInput,
  ResolveDisputeHoldInput,
  RewardSettlementResultDto,
} from './reward.schema';

describe('Economy Reward Schemas (Story 6.4)', () => {
  const validUuid1 = '11111111-1111-4111-8111-111111111111';
  const validUuid2 = '22222222-2222-4222-8222-222222222222';
  const validUuid3 = '33333333-3333-4333-8333-333333333333';
  const validUuid4 = '44444444-4444-4444-8444-444444444444';

  describe('creditInternalRewardSchema', () => {
    it('validates a valid authenticated internal reward input in default SHADOW mode', () => {
      const input: CreditInternalRewardInput = {
        responseId: validUuid1,
        publisherId: validUuid2,
        respondentId: validUuid3,
        amount: 25,
      };

      const result = creditInternalRewardSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.policyMode).toBe('SHADOW');
        expect(result.data.amount).toBe(25);
        expect(result.data.respondentId).toBe(validUuid3);
      }
    });

    it('allows null respondentId for guest internal surveys', () => {
      const input = {
        responseId: validUuid1,
        publisherId: validUuid2,
        respondentId: null,
        amount: 15,
        policyMode: 'ADVISORY' as const,
      };

      const result = creditInternalRewardSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.respondentId).toBeNull();
        expect(result.data.policyMode).toBe('ADVISORY');
      }
    });

    it('validates ENFORCED policy mode', () => {
      const input = {
        responseId: validUuid1,
        publisherId: validUuid2,
        respondentId: validUuid3,
        amount: 30,
        policyMode: 'ENFORCED' as const,
      };

      const result = creditInternalRewardSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects invalid or non-positive amounts', () => {
      expect(
        creditInternalRewardSchema.safeParse({
          responseId: validUuid1,
          publisherId: validUuid2,
          respondentId: validUuid3,
          amount: 0,
        }).success,
      ).toBe(false);

      expect(
        creditInternalRewardSchema.safeParse({
          responseId: validUuid1,
          publisherId: validUuid2,
          respondentId: validUuid3,
          amount: -5,
        }).success,
      ).toBe(false);

      expect(
        creditInternalRewardSchema.safeParse({
          responseId: validUuid1,
          publisherId: validUuid2,
          respondentId: validUuid3,
          amount: 12.5,
        }).success,
      ).toBe(false);
    });

    it('rejects non-uuid strings', () => {
      expect(
        creditInternalRewardSchema.safeParse({
          responseId: 'invalid-id',
          publisherId: validUuid2,
          respondentId: validUuid3,
          amount: 10,
        }).success,
      ).toBe(false);
    });
  });

  describe('creditPendingRewardSchema', () => {
    it('validates a valid external pending reward input', () => {
      const input: CreditPendingRewardInput = {
        attemptId: validUuid1,
        publisherId: validUuid2,
        respondentId: validUuid3,
        amount: 20,
      };

      const result = creditPendingRewardSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects missing attemptId or non-positive amount', () => {
      expect(
        creditPendingRewardSchema.safeParse({
          publisherId: validUuid2,
          respondentId: validUuid3,
          amount: 20,
        }).success,
      ).toBe(false);

      expect(
        creditPendingRewardSchema.safeParse({
          attemptId: validUuid1,
          publisherId: validUuid2,
          respondentId: validUuid3,
          amount: -1,
        }).success,
      ).toBe(false);
    });
  });

  describe('releasePendingRewardSchema', () => {
    it('validates a valid pending release input', () => {
      const input: ReleasePendingRewardInput = {
        attemptId: validUuid1,
        respondentId: validUuid2,
        amount: 20,
      };

      const result = releasePendingRewardSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('disputeHoldSchema and resolveDisputeHoldSchema', () => {
    it('validates a valid dispute hold input', () => {
      const input: DisputeHoldInput = {
        caseId: validUuid1,
        attemptId: validUuid2,
        respondentId: validUuid3,
        amount: 20,
      };

      const result = disputeHoldSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates resolve dispute hold with RELEASE_TO_RESPONDENT', () => {
      const input: ResolveDisputeHoldInput = {
        caseId: validUuid1,
        respondentId: validUuid2,
        publisherId: validUuid3,
        amount: 20,
        outcome: 'RELEASE_TO_RESPONDENT',
      };

      const result = resolveDisputeHoldSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates resolve dispute hold with REFUND_TO_PUBLISHER', () => {
      const input: ResolveDisputeHoldInput = {
        caseId: validUuid1,
        respondentId: validUuid2,
        publisherId: validUuid3,
        amount: 20,
        outcome: 'REFUND_TO_PUBLISHER',
      };

      const result = resolveDisputeHoldSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects invalid outcome', () => {
      const input = {
        caseId: validUuid1,
        respondentId: validUuid2,
        publisherId: validUuid3,
        amount: 20,
        outcome: 'INVALID_OUTCOME',
      };

      const result = resolveDisputeHoldSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('Epic 6 review P1/P2 request bodies', () => {
    it('release-pending accepts an empty body or an Admin respondentId only', () => {
      expect(releasePendingRewardRequestSchema.safeParse({}).success).toBe(
        true,
      );
      expect(
        releasePendingRewardRequestSchema.safeParse({
          respondentId: validUuid4,
        }).success,
      ).toBe(true);
      // Client-supplied amounts and dispute flags are no longer accepted.
      expect(
        releasePendingRewardRequestSchema.safeParse({ amount: 20 }).success,
      ).toBe(false);
      expect(
        releasePendingRewardRequestSchema.safeParse({
          isDisputeHoldLocked: false,
        }).success,
      ).toBe(false);
    });

    it('release-matured bounds the batch and validates the cutoff', () => {
      expect(releaseMaturedPendingRewardsSchema.safeParse({}).success).toBe(
        true,
      );
      expect(
        releaseMaturedPendingRewardsSchema.safeParse({
          cutoffDate: new Date().toISOString(),
          limit: 500,
        }).success,
      ).toBe(true);
      expect(
        releaseMaturedPendingRewardsSchema.safeParse({ limit: 0 }).success,
      ).toBe(false);
      expect(
        releaseMaturedPendingRewardsSchema.safeParse({ limit: 501 }).success,
      ).toBe(false);
      expect(
        releaseMaturedPendingRewardsSchema.safeParse({ cutoffDate: 'soon' })
          .success,
      ).toBe(false);
    });

    it('reward re-drive bodies must be empty', () => {
      expect(rewardRedriveRequestSchema.safeParse({}).success).toBe(true);
      expect(
        rewardRedriveRequestSchema.safeParse({ rewardPerResponse: 1000 })
          .success,
      ).toBe(false);
    });
  });

  describe('rewardSettlementResultSchema', () => {
    it('validates SETTLED result DTO', () => {
      const dto: RewardSettlementResultDto = {
        status: 'SETTLED',
        journalId: validUuid4,
        amount: 25,
        targetAccountClass: 'USER_AVAILABLE',
        settledAt: new Date().toISOString(),
      };

      const result = rewardSettlementResultSchema.safeParse(dto);
      expect(result.success).toBe(true);
    });

    it('validates SKIPPED_GUEST result DTO', () => {
      const dto: RewardSettlementResultDto = {
        status: 'SKIPPED_GUEST',
        journalId: null,
        amount: 0,
        targetAccountClass: null,
        settledAt: new Date().toISOString(),
      };

      const result = rewardSettlementResultSchema.safeParse(dto);
      expect(result.success).toBe(true);
    });
  });
});
