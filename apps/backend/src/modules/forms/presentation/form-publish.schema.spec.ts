import {
  isValidStatusTransition,
  isFormImmutable,
  determinePublishTargetStatus,
  publishFormSchema,
  closeFormSchema,
  formStatusTransitionSchema,
  FORM_STATUS_TRANSITIONS,
} from '@rescom/schemas';

describe('Story 2.6: Form Publish Lifecycle & Immutability Specification', () => {
  describe('Form Lifecycle State Machine (AC2)', () => {
    it('defines valid state transitions from DRAFT', () => {
      expect(isValidStatusTransition('DRAFT', 'ESCROW_LOCKED')).toBe(true);
      expect(isValidStatusTransition('DRAFT', 'PUBLISHED')).toBe(true);
      expect(isValidStatusTransition('DRAFT', 'MODERATION_QUEUE')).toBe(true);

      // Illegal transitions from DRAFT
      expect(isValidStatusTransition('DRAFT', 'CLOSED')).toBe(false);
      expect(isValidStatusTransition('DRAFT', 'DRAFT')).toBe(false);
    });

    it('defines valid state transitions from ESCROW_LOCKED', () => {
      expect(isValidStatusTransition('ESCROW_LOCKED', 'MODERATION_QUEUE')).toBe(
        true,
      );
      expect(isValidStatusTransition('ESCROW_LOCKED', 'PUBLISHED')).toBe(true);
      expect(isValidStatusTransition('ESCROW_LOCKED', 'CLOSED')).toBe(true);

      // Illegal transitions from ESCROW_LOCKED
      expect(isValidStatusTransition('ESCROW_LOCKED', 'DRAFT')).toBe(false);
    });

    it('defines valid state transitions from MODERATION_QUEUE', () => {
      expect(isValidStatusTransition('MODERATION_QUEUE', 'PUBLISHED')).toBe(
        true,
      );
      expect(isValidStatusTransition('MODERATION_QUEUE', 'CLOSED')).toBe(true);

      // Illegal transitions from MODERATION_QUEUE
      expect(isValidStatusTransition('MODERATION_QUEUE', 'DRAFT')).toBe(false);
      expect(isValidStatusTransition('MODERATION_QUEUE', 'ESCROW_LOCKED')).toBe(
        false,
      );
    });

    it('defines valid state transitions from PUBLISHED', () => {
      expect(isValidStatusTransition('PUBLISHED', 'CLOSED')).toBe(true);

      // Illegal transitions from PUBLISHED (immutability rule)
      expect(isValidStatusTransition('PUBLISHED', 'DRAFT')).toBe(false);
      expect(isValidStatusTransition('PUBLISHED', 'ESCROW_LOCKED')).toBe(false);
      expect(isValidStatusTransition('PUBLISHED', 'MODERATION_QUEUE')).toBe(
        false,
      );
    });

    it('defines CLOSED as a terminal state with no outgoing transitions', () => {
      expect(FORM_STATUS_TRANSITIONS['CLOSED']).toEqual([]);
      expect(isValidStatusTransition('CLOSED', 'DRAFT')).toBe(false);
      expect(isValidStatusTransition('CLOSED', 'PUBLISHED')).toBe(false);
      expect(isValidStatusTransition('CLOSED', 'ESCROW_LOCKED')).toBe(false);
    });

    it('correctly reports immutability status for each state', () => {
      expect(isFormImmutable('DRAFT')).toBe(false);
      expect(isFormImmutable('ESCROW_LOCKED')).toBe(true);
      expect(isFormImmutable('MODERATION_QUEUE')).toBe(true);
      expect(isFormImmutable('PUBLISHED')).toBe(true);
      expect(isFormImmutable('CLOSED')).toBe(true);
    });
  });

  describe('Publish Target Status Determination Heuristic (AC2, AC3)', () => {
    it('determines ESCROW_LOCKED for external surveys', () => {
      expect(
        determinePublishTargetStatus({
          type: 'EXTERNAL',
          rewardPerResponse: 0,
        }),
      ).toBe('ESCROW_LOCKED');

      expect(
        determinePublishTargetStatus({
          type: 'EXTERNAL',
          rewardPerResponse: 50,
        }),
      ).toBe('ESCROW_LOCKED');
    });

    it('determines ESCROW_LOCKED for internal surveys with rewards > 0', () => {
      expect(
        determinePublishTargetStatus({
          type: 'INTERNAL',
          rewardPerResponse: 10,
        }),
      ).toBe('ESCROW_LOCKED');
    });

    it('determines PUBLISHED for internal surveys with zero rewards', () => {
      expect(
        determinePublishTargetStatus({
          type: 'INTERNAL',
          rewardPerResponse: 0,
        }),
      ).toBe('PUBLISHED');
    });
  });

  describe('Publish & Transition Schemas Validation (AC1, AC3, AC4)', () => {
    it('validates publishFormSchema with empty object', () => {
      const parsed = publishFormSchema.safeParse({});
      expect(parsed.success).toBe(true);
    });

    it('validates publishFormSchema with explicit target status', () => {
      const parsed = publishFormSchema.safeParse({
        targetStatus: 'PUBLISHED',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.targetStatus).toBe('PUBLISHED');
      }
    });

    it('rejects invalid target status in publishFormSchema', () => {
      const parsed = publishFormSchema.safeParse({
        targetStatus: 'INVALID_STATUS',
      });
      expect(parsed.success).toBe(false);
    });

    it('validates closeFormSchema', () => {
      const parsed = closeFormSchema.safeParse({
        reason: 'Target completions reached',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.reason).toBe('Target completions reached');
      }
    });

    it('validates formStatusTransitionSchema', () => {
      const parsed = formStatusTransitionSchema.safeParse({
        targetStatus: 'MODERATION_QUEUE',
        note: 'Submitted to admin moderation',
      });
      expect(parsed.success).toBe(true);
    });
  });
});
