import {
  calculateTicketStatus,
  markUsedDecision,
  undoUseDecision,
  codeIssueDecision,
  historyMonthSummary,
} from './ticket-rules';
import { toVoucherTicket } from './voucher-ticket';
import { dueReminderWindow } from './reminder-plan';
import { resolveDecision } from './code-issue-resolution';
import { generateRefundReference } from './redemption-reference';
import {
  REFUND_REFERENCE_PATTERN,
  voucherTicketSchema,
  VoucherCategory,
} from '@rescom/schemas';
import { VoucherRecord } from '../application/ports/voucher-repository.port';

describe('Story 12.10 Domain Logic', () => {
  const now = new Date('2026-10-14T12:00:00.000Z').getTime();

  describe('calculateTicketStatus', () => {
    it('returns USED if usedAt is present even if expired', () => {
      const past = new Date(now - 1000).toISOString();
      expect(calculateTicketStatus(past, past, now)).toBe('USED');
    });

    it('returns EXPIRED when remaining <= 0', () => {
      expect(
        calculateTicketStatus(new Date(now).toISOString(), null, now),
      ).toBe('EXPIRED');
      expect(
        calculateTicketStatus(new Date(now - 1).toISOString(), null, now),
      ).toBe('EXPIRED');
    });

    it('returns EXPIRING when remaining <= 7 days and > 0', () => {
      const sevenDays = 7 * 86_400_000;
      expect(
        calculateTicketStatus(
          new Date(now + sevenDays).toISOString(),
          null,
          now,
        ),
      ).toBe('EXPIRING');
      expect(
        calculateTicketStatus(
          new Date(now + sevenDays - 1).toISOString(),
          null,
          now,
        ),
      ).toBe('EXPIRING');
    });

    it('returns UNUSED when remaining > 7 days', () => {
      const sevenDays = 7 * 86_400_000;
      expect(
        calculateTicketStatus(
          new Date(now + sevenDays + 1).toISOString(),
          null,
          now,
        ),
      ).toBe('UNUSED');
    });
  });

  describe('markUsedDecision / undoUseDecision / codeIssueDecision', () => {
    const baseTicket = {
      usedAt: null,
      undoUntil: null,
      expiresAt: new Date(now + 10 * 86_400_000).toISOString(),
      openIssue: null,
    };

    it('refunded ticket takes precedence over expired / used in all decisions', () => {
      const refundedTicket = {
        ...baseTicket,
        expiresAt: new Date(now - 1000).toISOString(),
        openIssue: { status: 'REFUNDED' },
      };
      expect(markUsedDecision(refundedTicket, now)).toEqual({
        ok: false,
        status: 409,
        code: 'TICKET_REFUNDED',
      });
      expect(undoUseDecision(refundedTicket, now)).toEqual({
        ok: false,
        status: 409,
        code: 'TICKET_REFUNDED',
      });
      expect(codeIssueDecision(refundedTicket, now)).toEqual({
        ok: false,
        status: 409,
        code: 'TICKET_REFUNDED',
      });
      const laterReport = {
        ...baseTicket,
        refunded: true,
        openIssue: { status: 'REJECTED' },
      };
      for (const decide of [
        markUsedDecision,
        undoUseDecision,
        codeIssueDecision,
      ]) {
        expect(decide(laterReport, now)).toMatchObject({
          ok: false,
          code: 'TICKET_REFUNDED',
        });
      }
    });

    it('markUsed: expired ticket returns 409 TICKET_EXPIRED', () => {
      const expired = {
        ...baseTicket,
        expiresAt: new Date(now - 1).toISOString(),
      };
      expect(markUsedDecision(expired, now)).toEqual({
        ok: false,
        status: 409,
        code: 'TICKET_EXPIRED',
      });
    });

    it('markUsed: already used ticket is idempotent ok with changed=false', () => {
      const used = {
        ...baseTicket,
        usedAt: new Date(now - 1000).toISOString(),
        undoUntil: new Date(now + 86_399_000).toISOString(),
      };
      expect(markUsedDecision(used, now)).toEqual({
        ok: true,
        changed: false,
      });
    });

    it('markUsed: marks unused ticket with 24h undoUntil', () => {
      const result = markUsedDecision(baseTicket, now);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.changed).toBe(true);
        expect(result.usedAt).toBe(new Date(now).toISOString());
        expect(result.undoUntil).toBe(new Date(now + 86_400_000).toISOString());
      }
    });

    it('undoUse: expired ticket is rejected even inside the undo window', () => {
      const used = {
        ...baseTicket,
        usedAt: new Date(now - 1000).toISOString(),
        undoUntil: new Date(now + 3600_000).toISOString(),
        expiresAt: new Date(now - 1).toISOString(),
      };
      expect(undoUseDecision(used, now)).toEqual({
        ok: false,
        status: 409,
        code: 'TICKET_EXPIRED',
      });
    });

    it('undoUse: unused ticket returns ok changed=false', () => {
      expect(undoUseDecision(baseTicket, now)).toEqual({
        ok: true,
        changed: false,
      });
    });

    it('undoUse: within window returns ok changed=true', () => {
      const used = {
        ...baseTicket,
        usedAt: new Date(now - 1000).toISOString(),
        undoUntil: new Date(now + 1000).toISOString(),
      };
      expect(undoUseDecision(used, now)).toEqual({
        ok: true,
        changed: true,
      });
    });

    it('undoUse: at undoUntil instant or after returns 409 UNDO_WINDOW_CLOSED', () => {
      const exactlyAt = {
        ...baseTicket,
        usedAt: new Date(now - 86_400_000).toISOString(),
        undoUntil: new Date(now).toISOString(),
      };
      expect(undoUseDecision(exactlyAt, now)).toEqual({
        ok: false,
        status: 409,
        code: 'UNDO_WINDOW_CLOSED',
      });
    });

    it('codeIssue: already open issue returns 409 CODE_ISSUE_ALREADY_OPEN', () => {
      const open = {
        ...baseTicket,
        openIssue: { status: 'OPEN' },
      };
      expect(codeIssueDecision(open, now)).toEqual({
        ok: false,
        status: 409,
        code: 'CODE_ISSUE_ALREADY_OPEN',
      });
    });
  });

  describe('dueReminderWindow', () => {
    const baseReminderTicket = {
      status: 'SUCCEEDED',
      used: false,
      refunded: false,
      redeemedAt: new Date(now - 10 * 86_400_000).toISOString(),
      expiresAt: new Date(now + 8 * 86_400_000).toISOString(),
    };

    it('returns null if used or refunded or not SUCCEEDED', () => {
      expect(
        dueReminderWindow({ ...baseReminderTicket, used: true }, now),
      ).toBeNull();
      expect(
        dueReminderWindow({ ...baseReminderTicket, refunded: true }, now),
      ).toBeNull();
      expect(
        dueReminderWindow({ ...baseReminderTicket, status: 'FAILED' }, now),
      ).toBeNull();
    });

    it('returns null if remaining > 7 days', () => {
      expect(dueReminderWindow(baseReminderTicket, now)).toBeNull();
    });

    it('returns 7D when remaining <= 7 days and > 1 day', () => {
      const ticket = {
        ...baseReminderTicket,
        expiresAt: new Date(now + 7 * 86_400_000).toISOString(),
      };
      expect(dueReminderWindow(ticket, now)).toBe('7D');
    });

    it('skips 7D when redeemed inside 7D window', () => {
      const ticket = {
        ...baseReminderTicket,
        redeemedAt: new Date(now - 3600_000).toISOString(), // redeemed 1h ago
        expiresAt: new Date(now + 5 * 86_400_000).toISOString(), // expires in 5 days (boundary was 2 days ago)
      };
      expect(dueReminderWindow(ticket, now)).toBeNull();
    });

    it('returns 1D when remaining <= 24 hours', () => {
      const ticket = {
        ...baseReminderTicket,
        expiresAt: new Date(now + 24 * 3600_000).toISOString(),
      };
      expect(dueReminderWindow(ticket, now)).toBe('1D');
    });

    it('skips 1D when redeemed inside 1D window', () => {
      const ticket = {
        ...baseReminderTicket,
        redeemedAt: new Date(now - 3600_000).toISOString(),
        expiresAt: new Date(now + 12 * 3600_000).toISOString(), // boundary was 12h ago
      };
      expect(dueReminderWindow(ticket, now)).toBeNull();
    });
  });

  describe('resolveDecision matrix', () => {
    const openReport = { id: 'r1', status: 'OPEN' };
    const validTicket = {
      expiresAt: new Date(now + 86_400_000).toISOString(),
      refunded: false,
    };
    const regularVoucher = {
      isSharedCode: false,
      stockRemaining: 5,
      codesAvailable: 5,
    };

    it('rejects already resolved reports with 409 CODE_ISSUE_ALREADY_RESOLVED', () => {
      expect(
        resolveDecision(
          { id: 'r1', status: 'REPLACED' },
          validTicket,
          regularVoucher,
          'REPLACE',
          now,
        ),
      ).toEqual({
        ok: false,
        status: 409,
        code: 'CODE_ISSUE_ALREADY_RESOLVED',
      });
    });

    it('REJECT is always allowed on OPEN report', () => {
      expect(
        resolveDecision(
          openReport,
          { ...validTicket, expiresAt: new Date(now - 1).toISOString() },
          { ...regularVoucher, isSharedCode: true, stockRemaining: 0 },
          'REJECT',
          now,
        ),
      ).toEqual({ ok: true });
    });

    it('REFUND is allowed on expired ticket but blocked if already refunded', () => {
      expect(
        resolveDecision(
          openReport,
          { ...validTicket, expiresAt: new Date(now - 1).toISOString() },
          regularVoucher,
          'REFUND',
          now,
        ),
      ).toEqual({ ok: true });

      expect(
        resolveDecision(
          openReport,
          { ...validTicket, refunded: true },
          regularVoucher,
          'REFUND',
          now,
        ),
      ).toEqual({ ok: false, status: 409, code: 'TICKET_REFUNDED' });
    });

    it('REPLACE blocked on shared code voucher', () => {
      expect(
        resolveDecision(
          openReport,
          validTicket,
          { ...regularVoucher, isSharedCode: true },
          'REPLACE',
          now,
        ),
      ).toEqual({ ok: false, status: 409, code: 'REPLACEMENT_NOT_SUPPORTED' });
    });

    it('REPLACE blocked on expired ticket', () => {
      expect(
        resolveDecision(
          openReport,
          { ...validTicket, expiresAt: new Date(now - 1).toISOString() },
          regularVoucher,
          'REPLACE',
          now,
        ),
      ).toEqual({ ok: false, status: 409, code: 'TICKET_EXPIRED' });
    });

    it('REPLACE blocked on no stock or no codes', () => {
      expect(
        resolveDecision(
          openReport,
          validTicket,
          { ...regularVoucher, stockRemaining: 0 },
          'REPLACE',
          now,
        ),
      ).toEqual({ ok: false, status: 409, code: 'NO_REPLACEMENT_AVAILABLE' });
    });

    it('REPLACE ok when all valid', () => {
      expect(
        resolveDecision(
          openReport,
          validTicket,
          regularVoucher,
          'REPLACE',
          now,
        ),
      ).toEqual({ ok: true });
    });
  });

  describe('generateRefundReference', () => {
    it('generates RFD-YYYY-XXXX pattern with valid characters', () => {
      const ref = generateRefundReference(2026);
      expect(REFUND_REFERENCE_PATTERN.test(ref)).toBe(true);
      expect(ref.startsWith('RFD-2026-')).toBe(true);
    });
  });

  describe('toVoucherTicket', () => {
    const mockVoucher: VoucherRecord = {
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Highlands Coffee 50k',
      brand: { id: 'highlands', name: 'Highlands Coffee' },
      category: 'COFFEE' as VoucherCategory,
      valueVnd: 50000,
      basePoints: 100,
      promoPoints: null,
      priceVersion: 1,
      stockTotal: 10,
      stockRemaining: 5,
      codesAvailable: 5,
      redeemStartsAt: new Date(now - 86_400_000).toISOString(),
      redeemEndsAt: new Date(now + 86_400_000).toISOString(),
      codeExpiresAt: new Date(now + 10 * 86_400_000).toISOString(),
      state: 'ACTIVE',
      isVisible: true,
      imageUrl: null,
      description: 'Desc',
      whereToUse: 'Stores',
      terms: ['Terms'],
      howToUse: ['Show code'],
      isSharedCode: false,
      sharedCode: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      createdById: '00000000-0000-4000-8000-000000000099',
    };

    const mockRedemption = {
      id: '00000000-0000-4000-8000-000000000002',
      reference: 'RDM-2026-ABCD',
      pricePoints: 100,
      priceSource: 'BASE' as const,
      createdAt: new Date(now).toISOString(),
    };

    it('without facts produces redeem-result compatible DTO', () => {
      const ticket = toVoucherTicket(
        mockRedemption,
        mockVoucher,
        'CODE1234',
        now,
      );
      expect(ticket.code).toBe('CODE1234');
      expect(ticket.usedAt).toBeNull();
      expect(ticket.undoUntil).toBeNull();
      expect(ticket.openIssue).toBeNull();
      expect(voucherTicketSchema.safeParse(ticket).success).toBe(true);
    });

    it('with facts updates code to replacementCode and reflects usage', () => {
      const usedAt = new Date(now - 1000).toISOString();
      const undoUntil = new Date(now + 86_399_000).toISOString();
      const ticket = toVoucherTicket(
        mockRedemption,
        mockVoucher,
        'CODE1234',
        now,
        {
          usage: { usedAt, undoUntil },
          latestIssue: {
            id: '00000000-0000-4000-8000-000000000003',
            status: 'REPLACED',
          },
          replacementCode: 'NEWCODE5678',
        },
      );
      expect(ticket.code).toBe('NEWCODE5678');
      expect(ticket.status).toBe('USED');
      expect(ticket.usedAt).toBe(usedAt);
      expect(ticket.undoUntil).toBe(undoUntil);
      expect(ticket.openIssue).toEqual({
        id: '00000000-0000-4000-8000-000000000003',
        status: 'REPLACED',
      });
      expect(voucherTicketSchema.safeParse(ticket).success).toBe(true);
    });
  });

  describe('historyMonthSummary across Vietnam month boundary', () => {
    it('groups correctly at 23:59:59.999+07 vs 00:00:00+07', () => {
      // 2026-10-31 23:59:59.999 Vietnam = 2026-10-31 16:59:59.999 UTC
      const endOfOctVn = new Date('2026-10-31T16:59:59.999Z').getTime();
      // 2026-11-01 00:00:00.000 Vietnam = 2026-10-31 17:00:00.000 UTC
      const startOfNovVn = new Date('2026-10-31T17:00:00.000Z').getTime();

      const rows = [
        {
          kind: 'SUCCEEDED' as const,
          points: -100,
          createdAt: new Date(endOfOctVn).toISOString(),
        },
        {
          kind: 'REFUNDED' as const,
          points: 100,
          createdAt: new Date(endOfOctVn).toISOString(),
        },
        {
          kind: 'SUCCEEDED' as const,
          points: -200,
          createdAt: new Date(startOfNovVn).toISOString(),
        },
      ];

      const octSummary = historyMonthSummary(rows, endOfOctVn);
      expect(octSummary).toEqual({
        month: '2026-10',
        pointsSpent: 0,
        voucherCount: 0,
      });

      const novSummary = historyMonthSummary(rows, startOfNovVn);
      expect(novSummary).toEqual({
        month: '2026-11',
        pointsSpent: 200,
        voucherCount: 1,
      });
    });
  });
});
