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
});
