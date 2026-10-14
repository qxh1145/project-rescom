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
import {
  adminFlashStatus,
  flashItemState,
  flashProgress,
  endEarlyDecision,
  flashConflicts,
} from './flash-sale-rules';
import {
  reservationPlan,
  settlementPlan,
  isReserveDue,
  isSettleDue,
} from './flash-sale-settlement';
import { nextFlashSaleCode } from './flash-sale-code';

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

      // Under 12.9 reserve-at-start, quota already left stock_remaining at start:
      // stockRemaining = 0 does NOT block a Flash purchase (guarded by sold < quota).
      expect(
        decideRedemption({ ...v, stockRemaining: 0 }, activeFlash, quote, now),
      ).toBeNull();
      // But codesAvailable = 0 blocks both:
      expect(
        decideRedemption({ ...v, codesAvailable: 0 }, activeFlash, quote, now),
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

  describe('Story 12.9 flash sale lifecycle domain units', () => {
    const baseVoucher = {
      id: 'v-1',
      state: 'ACTIVE',
      isVisible: true,
      redeemStartsAt: '2026-01-01T00:00:00.000Z',
      redeemEndsAt: '2026-02-01T00:00:00.000Z',
      isSharedCode: false,
      stockRemaining: 10,
      basePoints: 100,
      promoPoints: 80,
    };
    const tNow = Date.parse('2026-01-10T12:00:00.000Z');

    it('validates flashConflicts boundary and error codes', () => {
      const startMs = tNow + 3600_000;
      const endMs = startMs + 3600_000;
      const input = {
        startsAt: new Date(startMs).toISOString(),
        endsAt: new Date(endMs).toISOString(),
        items: [
          {
            voucherId: 'v-1',
            flashPoints: 70,
            quota: 10, // quota == stock accepted
            perUserCap: 1,
          },
        ],
      };

      // Happy path: no conflicts
      expect(flashConflicts(input, [baseVoucher], [], tNow)).toEqual([]);

      // startsAt == now rejected
      const pastInput = {
        ...input,
        startsAt: new Date(tNow).toISOString(),
      };
      expect(flashConflicts(pastInput, [baseVoucher], [], tNow)).toEqual([
        { path: 'startsAt', code: 'FLASH_STARTS_IN_PAST', details: {} },
      ]);

      // price == regular rejected (regular = promo 80)
      const priceEqRegular = {
        ...input,
        items: [{ ...input.items[0], flashPoints: 80 }],
      };
      expect(flashConflicts(priceEqRegular, [baseVoucher], [], tNow)).toEqual([
        {
          path: 'items.0.flashPoints',
          code: 'FLASH_PRICE_NOT_BELOW_REGULAR',
          details: { regular: 80 },
        },
      ]);

      // quota == stock + 1 rejected
      const quotaExceeds = {
        ...input,
        items: [{ ...input.items[0], quota: 11 }],
      };
      expect(flashConflicts(quotaExceeds, [baseVoucher], [], tNow)).toEqual([
        {
          path: 'items.0.quota',
          code: 'FLASH_QUOTA_EXCEEDS_STOCK',
          details: { available: 10 },
        },
      ]);

      // voucher not flashable (inactive or invisible or out-of-range)
      expect(
        flashConflicts(input, [{ ...baseVoucher, state: 'PAUSED' }], [], tNow),
      ).toEqual([
        {
          path: 'items.0.voucherId',
          code: 'VOUCHER_NOT_FLASHABLE',
          details: {},
        },
      ]);
    });

    it('enforces overlap [start, end) rules: half-open boundary and early end shortening', () => {
      const s1 = '2026-01-10T14:00:00.000Z';
      const e1 = '2026-01-10T16:00:00.000Z';
      const existing = [
        {
          id: 'fs-1',
          code: 'FS-260110-A',
          startsAt: s1,
          endsAt: e1,
          endedEarlyAt: null,
          settledAt: null,
          items: [{ voucherId: 'v-1' }],
        },
      ];

      // Overlap inside [14:00, 16:00)
      const overlapInput = {
        startsAt: '2026-01-10T15:00:00.000Z',
        endsAt: '2026-01-10T17:00:00.000Z',
        items: [{ voucherId: 'v-1', flashPoints: 50, quota: 2, perUserCap: 1 }],
      };
      expect(
        flashConflicts(overlapInput, [baseVoucher], existing, tNow),
      ).toEqual([
        {
          path: 'items.0.voucherId',
          code: 'FLASH_OVERLAP',
          details: { code: 'FS-260110-A' },
        },
      ]);

      // End touches start exactly: [16:00, 18:00) -> no overlap
      const touchingInput = {
        startsAt: '2026-01-10T16:00:00.000Z',
        endsAt: '2026-01-10T18:00:00.000Z',
        items: [{ voucherId: 'v-1', flashPoints: 50, quota: 2, perUserCap: 1 }],
      };
      expect(
        flashConflicts(touchingInput, [baseVoucher], existing, tNow),
      ).toEqual([]);

      // Existing ended early at 15:00 -> input [15:00, 17:00) no longer overlaps
      const endedEarlyExisting = [
        {
          ...existing[0],
          endedEarlyAt: '2026-01-10T15:00:00.000Z',
        },
      ];
      expect(
        flashConflicts(overlapInput, [baseVoucher], endedEarlyExisting, tNow),
      ).toEqual([]);
    });

    it('evaluates adminFlashStatus and flashItemState lifecycle transitions', () => {
      const s = '2026-01-11T12:00:00.000Z';
      const e = '2026-01-11T16:00:00.000Z';
      const sMs = Date.parse(s);
      const eMs = Date.parse(e);
      const item = {
        voucherId: 'v-1',
        flashPoints: 50,
        quota: 5,
        sold: 0,
        perUserCap: 1,
      };
      const sale = {
        startsAt: s,
        endsAt: e,
        reservedAt: null as string | null,
        settledAt: null as string | null,
        endedEarlyAt: null as string | null,
        items: [item],
      };

      // >24h away -> SCHEDULED
      expect(adminFlashStatus(sale, sMs - 25 * 3600_000)).toBe('SCHEDULED');
      // <=24h away -> UPCOMING
      expect(adminFlashStatus(sale, sMs - 23 * 3600_000)).toBe('UPCOMING');
      // Starts now but not yet reserved by job -> stays UPCOMING
      expect(adminFlashStatus(sale, sMs)).toBe('UPCOMING');
      expect(flashItemState(sale, item, sMs)).toBe('UPCOMING');

      // Reserved -> ACTIVE
      const reservedSale = { ...sale, reservedAt: new Date(sMs).toISOString() };
      expect(adminFlashStatus(reservedSale, sMs)).toBe('ACTIVE');
      expect(flashItemState(reservedSale, item, sMs)).toBe('ACTIVE');

      // All items sold -> SOLD_OUT
      const soldOutSale = {
        ...reservedSale,
        items: [{ ...item, sold: 5 }],
      };
      expect(adminFlashStatus(soldOutSale, sMs + 1000)).toBe('SOLD_OUT');
      expect(
        flashItemState(soldOutSale, soldOutSale.items[0], sMs + 1000),
      ).toBe('SOLD_OUT');

      // At end instant -> ENDED
      expect(adminFlashStatus(reservedSale, eMs)).toBe('ENDED');
      expect(flashItemState(reservedSale, item, eMs)).toBe('ENDED');

      // Ended early -> ENDED
      const endedEarly = {
        ...reservedSale,
        endedEarlyAt: '2026-01-11T13:00:00.000Z',
      };
      expect(
        adminFlashStatus(endedEarly, Date.parse(endedEarly.endedEarlyAt)),
      ).toBe('ENDED');
    });

    it('checks isReserveDue and isSettleDue boundaries at start-1ms, start, end-1ms, end', () => {
      const s = '2026-01-11T12:00:00.000Z';
      const e = '2026-01-11T16:00:00.000Z';
      const sMs = Date.parse(s);
      const eMs = Date.parse(e);
      const item = { quota: 5, sold: 0 };
      const sale = {
        startsAt: s,
        endsAt: e,
        reservedAt: null as string | null,
        settledAt: null as string | null,
        endedEarlyAt: null as string | null,
        items: [item],
      };

      // isReserveDue
      expect(isReserveDue(sale, sMs - 1)).toBe(false);
      expect(isReserveDue(sale, sMs)).toBe(true);
      expect(isReserveDue(sale, eMs - 1)).toBe(true);
      expect(isReserveDue(sale, eMs)).toBe(false);

      // Once reserved: not due for reserve
      const reserved = { ...sale, reservedAt: new Date(sMs).toISOString() };
      expect(isReserveDue(reserved, sMs)).toBe(false);

      // isSettleDue
      expect(isSettleDue(reserved, eMs - 1)).toBe(false);
      expect(isSettleDue(reserved, eMs)).toBe(true);
      expect(isSettleDue(reserved, eMs + 1)).toBe(true);

      // All items sold -> due for settle immediately
      const allSold = { ...reserved, items: [{ quota: 5, sold: 5 }] };
      expect(isSettleDue(allSold, sMs + 1000)).toBe(true);

      // Ended early -> due for settle immediately
      const endedEarly = {
        ...reserved,
        endedEarlyAt: new Date(sMs + 1000).toISOString(),
      };
      expect(isSettleDue(endedEarly, sMs + 1000)).toBe(true);

      // Settled -> not due
      const settled = { ...reserved, settledAt: new Date(eMs).toISOString() };
      expect(isSettleDue(settled, eMs + 1000)).toBe(false);
    });

    it('calculates reservationPlan and settlementPlan accurately', () => {
      const sale = {
        items: [
          { voucherId: 'v1', quota: 5, sold: 3 },
          { voucherId: 'v2', quota: 2, sold: 2 },
        ],
      };

      // Sufficient stock
      expect(
        reservationPlan(sale, [
          { id: 'v1', stockRemaining: 10 },
          { id: 'v2', stockRemaining: 2 },
        ]),
      ).toEqual({
        ok: true,
        perVoucher: [
          { voucherId: 'v1', quota: 5 },
          { voucherId: 'v2', quota: 2 },
        ],
      });

      // Short stock on v2
      expect(
        reservationPlan(sale, [
          { id: 'v1', stockRemaining: 10 },
          { id: 'v2', stockRemaining: 1 },
        ]),
      ).toEqual({
        ok: false,
        shortVoucherIds: ['v2'],
      });

      // Settlement plan returns unsold quota: v1 has 2 unsold, v2 has 0
      expect(settlementPlan(sale)).toEqual([
        { voucherId: 'v1', unsold: 2 },
        { voucherId: 'v2', unsold: 0 },
      ]);
    });

    it('generates nextFlashSaleCode and handles exhaustion at 26 sales', () => {
      const date = new Date('2026-10-15T08:00:00.000Z'); // 15:00 VN time (10/15)
      expect(nextFlashSaleCode(date, [])).toBe('FS-261015-A');
      expect(nextFlashSaleCode(date, ['FS-261015-A'])).toBe('FS-261015-B');
      expect(nextFlashSaleCode(date, ['FS-261015-A', 'FS-261015-B'])).toBe(
        'FS-261015-C',
      );

      const all26 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        .split('')
        .map((l) => `FS-261015-${l}`);
      expect(nextFlashSaleCode(date, all26)).toBeNull();
    });

    it('reservationPlan also requires unique codes >= quota for non-shared vouchers', () => {
      const sale = { items: [{ voucherId: 'v1', quota: 5 }] };
      expect(
        reservationPlan(sale, [
          {
            id: 'v1',
            stockRemaining: 10,
            codesAvailable: 4,
            isSharedCode: false,
          },
        ]),
      ).toEqual({ ok: false, shortVoucherIds: ['v1'] });
      expect(
        reservationPlan(sale, [
          {
            id: 'v1',
            stockRemaining: 10,
            codesAvailable: 5,
            isSharedCode: false,
          },
        ]).ok,
      ).toBe(true);
      expect(
        reservationPlan(sale, [
          {
            id: 'v1',
            stockRemaining: 10,
            codesAvailable: 1,
            isSharedCode: true,
          },
        ]).ok,
      ).toBe(true);
    });

    it('calculates flashProgress and evaluates endEarlyDecision', () => {
      const now = new Date('2026-10-15T11:00:00.000Z');
      const startsAt = new Date('2026-10-15T10:00:00.000Z');
      const endsAt = new Date('2026-10-15T12:00:00.000Z');

      const sale: any = {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reservedAt: startsAt.toISOString(),
        endedEarlyAt: null,
        settledAt: null,
        items: [
          {
            quota: 10,
            sold: 5,
            soldOutAt: null,
          },
        ],
      };

      const progress = flashProgress(sale, now.getTime());
      expect(progress[0].perMinute).toBeGreaterThanOrEqual(0);

      // Active sale can end early
      expect(endEarlyDecision(sale, now.getTime())).toMatchObject({
        ok: true,
        result: {
          returned: 5,
          items: [{ unsold: 5 }],
        },
      });

      // Ended sale cannot end early
      sale.endedEarlyAt = new Date('2026-10-15T10:30:00.000Z').toISOString();
      expect(endEarlyDecision(sale, now.getTime())).toEqual({
        ok: false,
        status: 409,
        code: 'FLASH_ALREADY_ENDED',
        details: {},
      });
    });
  });
});
