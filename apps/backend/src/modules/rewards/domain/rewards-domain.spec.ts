import {
  adminStockOf,
  VoucherInventory,
  voucherStateDecision,
  voucherVisibilityDecision,
} from './voucher.entity';
import { effectivePrice } from './voucher-price';
import {
  adminVoucherStatus,
  effectiveStatus,
  voucherAvailability,
} from './voucher-availability';
import { importCodesDecision, stockAdjustmentDecision } from './stock';
import { decideRedemption } from './redemption-decision';
import {
  checkRedemptionLimits,
  getVietnamCalendarDayRange,
} from './redemption-limits';
import { generateRedemptionReference } from './redemption-reference';
import { toVoucherTicket, calculateTicketStatus } from './voucher-ticket';
import { checkAccountEligibility } from './redemption-eligibility';

const v: VoucherInventory = {
  id: 'v',
  basePoints: 125,
  promoPoints: 90,
  priceVersion: 2,
  stockTotal: 10,
  stockRemaining: 6,
  codesAvailable: 6,
  redeemStartsAt: '2026-01-01T00:00:00Z',
  redeemEndsAt: '2026-02-01T00:00:00Z',
  state: 'ACTIVE',
  isVisible: true,
  isSharedCode: false,
};
const now = Date.parse('2026-01-15T00:00:00Z');

describe('Rewards domain', () => {
  it('prices Flash before promo before base with shared rounding', () => {
    expect(effectivePrice(v, { flashPoints: 75, sold: 0, quota: 1 })).toEqual({
      points: 75,
      basePoints: 125,
      source: 'FLASH',
      discountPercent: 40,
      priceVersion: 2,
    });
    expect(
      effectivePrice(v, { flashPoints: 75, sold: 1, quota: 1 }).points,
    ).toBe(90);
    expect(effectivePrice(v).discountPercent).toBe(28);
    expect(effectivePrice({ ...v, promoPoints: null }).source).toBe('BASE');
  });
  it('respects half-open window and Flash stock exception', () => {
    expect(voucherAvailability(v, Date.parse(v.redeemStartsAt as string))).toBe(
      'AVAILABLE',
    );
    expect(voucherAvailability(v, Date.parse(v.redeemEndsAt as string))).toBe(
      'EXPIRED',
    );
    expect(voucherAvailability(v, now - 30 * 86400000)).toBe('PAUSED');
    expect(voucherAvailability({ ...v, isVisible: false }, now)).toBe('HIDDEN');
    expect(effectiveStatus({ ...v, stockRemaining: 0 }, now, true)).toBe(
      'AVAILABLE',
    );
    expect(effectiveStatus({ ...v, codesAvailable: 0 }, now, true)).toBe(
      'SOLD_OUT',
    );
    expect(adminVoucherStatus({ ...v, state: 'ARCHIVED' }, now)).toBe(
      'ARCHIVED',
    );
    expect(adminVoucherStatus({ ...v, stockRemaining: 0 }, now)).toBe(
      'SOLD_OUT',
    );
  });
  it('rejects archived writes; allows idempotent updates', () => {
    expect(voucherStateDecision('ACTIVE', 'PAUSED')).toEqual({
      ok: true,
      changed: true,
    });
    expect(voucherStateDecision('PAUSED', 'ACTIVE')).toEqual({
      ok: true,
      changed: true,
    });
    expect(voucherStateDecision('ARCHIVED', 'ACTIVE')).toMatchObject({
      code: 'VOUCHER_ARCHIVED',
    });
    expect(
      voucherVisibilityDecision({ ...v, state: 'ARCHIVED' }, false),
    ).toMatchObject({ code: 'VOUCHER_ARCHIVED' });
    expect(voucherVisibilityDecision(v, true)).toEqual({
      ok: true,
      changed: false,
    });
  });
  it('accounts reserved stock and keeps mock conflict codes', () => {
    const stock = adminStockOf(v, 2);
    expect(stock).toEqual({
      total: 10,
      issued: 2,
      flashReserved: 2,
      remaining: 6,
      codesAvailable: 6,
    });
    expect(stockAdjustmentDecision(v, stock, 3)).toMatchObject({
      code: 'STOCK_BELOW_COMMITTED',
      details: { minimum: 4 },
    });
    expect(stockAdjustmentDecision(v, stock, 11)).toMatchObject({
      code: 'STOCK_INCREASE_NEEDS_CODES',
    });
    expect(
      stockAdjustmentDecision(v, { ...stock, codesAvailable: 1 }, 8),
    ).toMatchObject({ code: 'STOCK_EXCEEDS_CODES' });
    expect(stockAdjustmentDecision(v, stock, 8)).toEqual({
      ok: true,
      removeCodes: 2,
    });
  });
  it('rejects entire code import on duplicate or stored code', () => {
    expect(importCodesDecision([' A ', 'A', 'B'], ['B'])).toEqual({
      received: 3,
      accepted: 0,
      duplicatesInFile: ['A'],
      alreadyStored: ['B'],
      committed: false,
    });
    expect(importCodesDecision([' A ', 'B'], ['elsewhere'])).toEqual({
      received: 2,
      accepted: 2,
      duplicatesInFile: [],
      alreadyStored: [],
      committed: false,
    });
  });

  describe('Story 12.8 domain units', () => {
    it('decideRedemption follows exact mock order: status -> price/source -> stock/quota', () => {
      const activeFlash = {
        id: 'f-item',
        flashPoints: 75,
        quota: 5,
        sold: 2,
      };
      const quote = {
        pricePoints: 75,
        priceSource: 'FLASH' as const,
        priceVersion: 2,
        flashSaleItemId: 'f-item',
        expiresAt: new Date(now + 300000).toISOString(),
      };

      // Success
      expect(decideRedemption(v, activeFlash, quote, now)).toBeNull();

      // 1. Status: PAUSED voucher -> VOUCHER_UNAVAILABLE before anything else
      expect(
        decideRedemption({ ...v, state: 'PAUSED' }, activeFlash, quote, now),
      ).toEqual({
        code: 'VOUCHER_UNAVAILABLE',
        details: { voucherId: 'v', status: 'PAUSED' },
      });

      // 2. Price/expiry: quote expired -> PRICE_CHANGED
      expect(
        decideRedemption(v, activeFlash, quote, now + 300001),
      ).toMatchObject({
        code: 'PRICE_CHANGED',
        details: { voucherId: 'v' },
      });

      // Price version changed -> PRICE_CHANGED
      expect(
        decideRedemption(v, activeFlash, { ...quote, priceVersion: 1 }, now),
      ).toMatchObject({
        code: 'PRICE_CHANGED',
      });

      // Flash quota exhausted: the item falls back to the promo price, so a
      // Flash quote is stale -> PRICE_CHANGED carrying the fallback price.
      expect(
        decideRedemption(v, { ...activeFlash, sold: 5 }, quote, now),
      ).toMatchObject({
        code: 'PRICE_CHANGED',
        details: { voucherId: 'v', price: { source: 'PROMO', points: 90 } },
      });

      // Flash quota is carved out of voucher stock (D2): no stock -> SOLD_OUT.
      expect(
        decideRedemption({ ...v, stockRemaining: 0 }, activeFlash, quote, now),
      ).toMatchObject({ code: 'SOLD_OUT' });

      // Regular stock exhausted for regular quote
      const regQuote = {
        pricePoints: 90,
        priceSource: 'PROMO' as const,
        priceVersion: 2,
        flashSaleItemId: null,
        expiresAt: new Date(now + 300000).toISOString(),
      };
      expect(
        decideRedemption({ ...v, stockRemaining: 0 }, null, regQuote, now),
      ).toMatchObject({
        code: 'SOLD_OUT',
      });

      // A sold-out (still in-window) Flash must not invalidate a regular quote.
      expect(
        decideRedemption(v, { ...activeFlash, sold: 5 }, regQuote, now),
      ).toBeNull();

      // Flash ended (no active item): a Flash quote is stale.
      expect(decideRedemption(v, null, quote, now)).toMatchObject({
        code: 'PRICE_CHANGED',
      });
    });

    it('checkRedemptionLimits enforces limits boundaries and Vietnam calendar day', () => {
      // 2 per voucher per 30 days ok, 3rd blocked
      expect(
        checkRedemptionLimits(
          { perVoucher30dCount: 1, todayPoints: 100 },
          50,
          500,
        ),
      ).toBeNull();
      expect(
        checkRedemptionLimits(
          { perVoucher30dCount: 2, todayPoints: 100 },
          50,
          500,
        ),
      ).toBe('VOUCHER_LIMIT_REACHED');

      // Daily 500 limit: 450 + 50 ok, 451 + 50 blocked
      expect(
        checkRedemptionLimits(
          { perVoucher30dCount: 0, todayPoints: 450 },
          50,
          500,
        ),
      ).toBeNull();
      expect(
        checkRedemptionLimits(
          { perVoucher30dCount: 0, todayPoints: 451 },
          50,
          500,
        ),
      ).toBe('DAILY_LIMIT_REACHED');

      // Flash user cap
      expect(
        checkRedemptionLimits(
          { perVoucher30dCount: 0, todayPoints: 100, flashUserCount: 0 },
          50,
          500,
          { perUserCap: 1 },
        ),
      ).toBeNull();
      expect(
        checkRedemptionLimits(
          { perVoucher30dCount: 0, todayPoints: 100, flashUserCount: 1 },
          50,
          500,
          { perUserCap: 1 },
        ),
      ).toBe('FLASH_LIMIT_REACHED');

      // Vietnam calendar day range (UTC+7)
      // 2026-10-14 02:00:00 UTC = 2026-10-14 09:00:00 VN time
      const testDate = new Date('2026-10-14T02:00:00.000Z');
      const range = getVietnamCalendarDayRange(testDate);
      expect(range.start.toISOString()).toBe('2026-10-13T17:00:00.000Z'); // 00:00 VN time
      expect(range.end.toISOString()).toBe('2026-10-14T17:00:00.000Z'); // 24:00 VN time
    });

    it('generateRedemptionReference generates valid RDM-YYYY-XXXX format', () => {
      const mockRandom = {
        i: 0,
        random: () => 0.5,
      };
      const ref = generateRedemptionReference(2026, mockRandom);
      expect(ref).toMatch(/^RDM-2026-[0-9A-Z]{4}$/);
    });

    it('calculateTicketStatus and toVoucherTicket construct valid ticket', () => {
      const future = now + 10 * 86400000;
      expect(calculateTicketStatus(new Date(future), null, now)).toBe('UNUSED');
      expect(
        calculateTicketStatus(new Date(now + 3 * 86400000), null, now),
      ).toBe('EXPIRING');
      expect(calculateTicketStatus(new Date(now - 1000), null, now)).toBe(
        'EXPIRED',
      );
      expect(calculateTicketStatus(new Date(future), new Date(now), now)).toBe(
        'USED',
      );

      const ticket = toVoucherTicket(
        {
          id: '11111111-1111-4111-8111-111111111111',
          reference: 'RDM-2026-ABCD',
          pricePoints: 90,
          priceSource: 'PROMO',
          createdAt: new Date(now),
        },
        {
          id: 'v1',
          title: 'Voucher 1',
          brand: { id: 'highlands', name: 'Highlands Coffee' },
          category: 'COFFEE',
          valueVnd: 50000,
          isSharedCode: false,
          codeExpiresAt: new Date(future).toISOString(),
          howToUse: ['Show to cashier'],
        } as any,
        'CODE123',
        now,
      );

      expect(ticket.reference).toBe('RDM-2026-ABCD');
      expect(ticket.code).toBe('CODE123');
      expect(ticket.status).toBe('UNUSED');
      expect(ticket.pointsSpent).toBe(90);
    });

    it('checkAccountEligibility checks active, activation, survey and fraud flags', () => {
      // Inactive
      expect(
        checkAccountEligibility({
          isActive: false,
          isActivated: true,
          hasRecentCompletedSurvey: true,
          hasBlockingFraudFlag: false,
        }),
      ).toBe('ACCOUNT_LOCKED');

      // Not activated
      expect(
        checkAccountEligibility({
          isActive: true,
          isActivated: false,
          hasRecentCompletedSurvey: true,
          hasBlockingFraudFlag: false,
        }),
      ).toBe('ACCOUNT_NOT_ACTIVATED');

      // Flash requiring recent survey
      expect(
        checkAccountEligibility(
          {
            isActive: true,
            isActivated: true,
            hasRecentCompletedSurvey: false,
            hasBlockingFraudFlag: false,
          },
          { requireRecentSurvey: true, blockFlagged: false },
        ),
      ).toBe('NO_RECENT_SURVEY');

      // Flash blocking flagged
      expect(
        checkAccountEligibility(
          {
            isActive: true,
            isActivated: true,
            hasRecentCompletedSurvey: true,
            hasBlockingFraudFlag: true,
          },
          { requireRecentSurvey: false, blockFlagged: true },
        ),
      ).toBe('FRAUD_FLAGGED');
    });
  });
});
