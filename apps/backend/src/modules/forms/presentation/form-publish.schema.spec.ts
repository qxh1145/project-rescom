import {
  isValidStatusTransition,
  isFormImmutable,
  isOwnerReopenableClose,
  determinePublishTargetStatus,
  publishFormSchema,
  closeFormSchema,
  formCloseKindEnum,
  formStatusEnum,
  formStatusTransitionSchema,
  FORM_STATUS_TRANSITIONS,
  FormStatusEnum,
} from '@rescom/schemas';

describe('Story 2.6 / 8.1: Form Publish Lifecycle & Immutability Specification', () => {
  /**
   * Decision E8-D1 (2026-09-26): the signed-off lifecycle transition table
   * (ARCHITECTURE-SPINE open question "approve and contract-test the Form
   * publication/moderation lifecycle transition table"). Every from -> to pair
   * is pinned, so any change to the table fails here and needs a new
   * sign-off. The two out-of-table transitions (new version PUBLISHED -> DRAFT,
   * owner reopen CLOSED -> PUBLISHED) are commands, not table edges.
   * Decision D2 (Bug 3.1) added DRAFT -> CLOSED for re-versioned drafts (the
   * service requires a published version).
   */
  describe('Decision E8-D1: signed-off transition table (exhaustive contract)', () => {
    const APPROVED_TABLE: Record<FormStatusEnum, FormStatusEnum[]> = {
      DRAFT: ['MODERATION_QUEUE', 'CLOSED'],
      ESCROW_LOCKED: ['MODERATION_QUEUE', 'CLOSED'],
      MODERATION_QUEUE: ['PUBLISHED', 'CLOSED'],
      PUBLISHED: ['CLOSED'],
      CLOSED: [],
    };
    const statuses = formStatusEnum.options;
    const pairs = statuses.flatMap((from) =>
      statuses.map((to) => [from, to] as const),
    );

    it('covers every FormStatus value and nothing else', () => {
      expect(Object.keys(FORM_STATUS_TRANSITIONS).sort()).toEqual(
        [...statuses].sort(),
      );
      expect(FORM_STATUS_TRANSITIONS).toEqual(APPROVED_TABLE);
    });

    it.each(pairs)('%s -> %s matches the approved table', (from, to) => {
      expect(isValidStatusTransition(from, to)).toBe(
        APPROVED_TABLE[from].includes(to),
      );
    });

    it('has no path to PUBLISHED that skips moderation', () => {
      const intoPublished = statuses.filter((from) =>
        isValidStatusTransition(from, 'PUBLISHED'),
      );
      expect(intoPublished).toEqual(['MODERATION_QUEUE']);
    });

    it('records who closed a survey and lets only the owner reopen it (plus a deadline close)', () => {
      expect(formCloseKindEnum.options).toEqual([
        'OWNER',
        'ADMIN',
        'MODERATION',
        'DEADLINE',
        'QUOTA',
      ]);
      expect(isOwnerReopenableClose('OWNER')).toBe(true);
      expect(isOwnerReopenableClose('ADMIN')).toBe(false);
      expect(isOwnerReopenableClose('MODERATION')).toBe(false);
      // Story IR.2b Q3 (default): the owner may reopen a deadline close
      // (with a new future-or-null deadline, enforced by the service).
      expect(isOwnerReopenableClose('DEADLINE')).toBe(true);
      // Plan 2.3: a QUOTA close stays NOT reopenable for now.
      expect(isOwnerReopenableClose('QUOTA')).toBe(false);
      // A close recorded before the close kind existed fails closed.
      expect(isOwnerReopenableClose(null)).toBe(false);
      expect(isOwnerReopenableClose(undefined)).toBe(false);
    });
  });

  describe('Form Lifecycle State Machine (Story 2.6 AC2, Story 8.1 AC1)', () => {
    it('only allows DRAFT into the moderation queue or (re-versioned drafts) closed', () => {
      expect(isValidStatusTransition('DRAFT', 'MODERATION_QUEUE')).toBe(true);

      // Story 8.1: publishing can no longer bypass moderation
      expect(isValidStatusTransition('DRAFT', 'PUBLISHED')).toBe(false);
      expect(isValidStatusTransition('DRAFT', 'ESCROW_LOCKED')).toBe(false);
      expect(FORM_STATUS_TRANSITIONS['DRAFT']).toEqual([
        'MODERATION_QUEUE',
        'CLOSED',
      ]);

      // Decision D2: a re-versioned draft can be closed (its Escrow refunded);
      // the service rejects the close of a never-published draft.
      expect(isValidStatusTransition('DRAFT', 'CLOSED')).toBe(true);

      // Illegal transitions from DRAFT
      expect(isValidStatusTransition('DRAFT', 'DRAFT')).toBe(false);
    });

    it('keeps legacy ESCROW_LOCKED rows able to enter moderation or close only', () => {
      expect(isValidStatusTransition('ESCROW_LOCKED', 'MODERATION_QUEUE')).toBe(
        true,
      );
      expect(isValidStatusTransition('ESCROW_LOCKED', 'CLOSED')).toBe(true);

      // Story 8.1: ESCROW_LOCKED -> PUBLISHED bypassed moderation
      expect(isValidStatusTransition('ESCROW_LOCKED', 'PUBLISHED')).toBe(false);
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

  describe('Publish Target Status (Story 8.1 AC1, FR-20)', () => {
    it.each([
      ['EXTERNAL', 0],
      ['EXTERNAL', 50],
      ['INTERNAL', 10],
      ['INTERNAL', 0],
    ] as const)(
      'sends every %s survey (reward %d) to MODERATION_QUEUE',
      (type, rewardPerResponse) => {
        expect(determinePublishTargetStatus({ type, rewardPerResponse })).toBe(
          'MODERATION_QUEUE',
        );
      },
    );
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
