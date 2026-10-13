import { test } from 'node:test';
import assert from 'node:assert/strict';

const { decideRedemption, effectiveVoucherPrice, effectiveStatus, forcedError, ticketStatus } = await import('../mocks/data/rewards-rules.ts');
const now = Date.now();
const voucher = { id: 'voucher', basePoints: 250, promoPoints: null, priceVersion: 1, stockRemaining: 10, codesAvailable: 5, state: 'ACTIVE', isVisible: true, redeemStartsAt: new Date(now - 10000).toISOString(), redeemEndsAt: new Date(now + 1000000).toISOString() };
const flash = [{ id: 'flash', startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 60000).toISOString(), endedEarlyAt: null, items: [{ id: 'item', voucherId: voucher.id, flashPoints: 150, quota: 10, sold: 0 }] }];
const quote = { price: { points: 150, basePoints: 250, source: 'FLASH', discountPercent: 40, priceVersion: 1 }, flashSaleItemId: 'item', expiresAt: new Date(now + 5000).toISOString() };

test('(Story 12.1, FR-68) flash window [start, end) exclusive; stale quote → PRICE_CHANGED', () => {
  assert.equal(effectiveVoucherPrice(voucher, flash, now).price.points, 150);
  assert.equal(effectiveVoucherPrice(voucher, flash, now + 60000).price.points, 250, 'at endsAt, Flash is over');
  assert.equal(decideRedemption(voucher, flash, quote, 300, now + 60000).code, 'PRICE_CHANGED');
});

test('(Story 12.1, FR-68) price precedence: Flash > promo > base; Flash sold out falls to promo/base', () => {
  const promoVoucher = { ...voucher, promoPoints: 200 };
  assert.equal(effectiveVoucherPrice(promoVoucher, flash, now).price.source, 'FLASH');
  assert.equal(effectiveVoucherPrice(promoVoucher, [], now).price.source, 'PROMO');
  assert.equal(effectiveVoucherPrice(voucher, [], now).price.source, 'BASE');
  const soldOutFlash = [{ ...flash[0], items: [{ ...flash[0].items[0], sold: 10 }] }];
  assert.equal(effectiveVoucherPrice(promoVoucher, soldOutFlash, now).price.source, 'PROMO');
  assert.equal(effectiveVoucherPrice(voucher, soldOutFlash, now).price.source, 'BASE');
});

test('(Story 12.1, FR-68) effectiveStatus: SOLD_OUT regular stays AVAILABLE when Flash has quota', () => {
  const noStock = { ...voucher, stockRemaining: 0 };
  assert.equal(effectiveStatus(noStock, flash, now), 'AVAILABLE');
  assert.equal(effectiveStatus(noStock, [], now), 'SOLD_OUT');
  assert.equal(effectiveStatus({ ...noStock, codesAvailable: 0 }, flash, now), 'SOLD_OUT');
});

test('(Story 12.1, FR-70) decideRedemption error precedence: unavailable > price > stock > balance', () => {
  assert.equal(decideRedemption({ ...voucher, state: 'PAUSED' }, flash, quote, 0, now)?.code, 'VOUCHER_UNAVAILABLE');
  assert.equal(decideRedemption({ ...voucher, codesAvailable: 0 }, flash, quote, 300, now)?.code, 'SOLD_OUT');
  assert.equal(decideRedemption(voucher, flash, quote, 149, now)?.code, 'INSUFFICIENT_POINTS');
  assert.equal(decideRedemption(voucher, flash, quote, 150, now), null);
});

test('(Story 12.1, FR-70) forcedError builds real details from current state', () => {
  const err = forcedError('INSUFFICIENT_POINTS', voucher, flash, 42, now);
  assert.equal(err.details.available, 42, 'uses actual viewer balance');
  assert.equal(err.details.required, 150, 'uses current effective price');
  const changed = forcedError('PRICE_CHANGED', voucher, flash, 300, now);
  assert.ok(changed.details.price);
});

test('(Story 12.1, FR-71) ticket status computed at read time, EXPIRING at ≤7 days', () => {
  assert.equal(ticketStatus({ usedAt: null, expiresAt: new Date(now + 6 * 86400000).toISOString() }, now), 'EXPIRING');
  assert.equal(ticketStatus({ usedAt: null, expiresAt: new Date(now + 8 * 86400000).toISOString() }, now), 'UNUSED');
  assert.equal(ticketStatus({ usedAt: null, expiresAt: new Date(now).toISOString() }, now), 'EXPIRED');
  assert.equal(ticketStatus({ usedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + day).toISOString() }, now), 'USED');
});
const day = 86400000;

// --- Seed integration (requires module loader for @/ and extensionless .ts) ---
const { register } = await import('node:module');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const loader = `import { existsSync, statSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
 if (specifier.startsWith('@/')) { const file = path.join(${JSON.stringify(root)}, specifier.slice(2)); for (const f of [file + '.ts', file, path.join(file, 'index.ts')]) if (existsSync(f) && statSync(f).isFile()) return { url:pathToFileURL(f).href, shortCircuit:true }; }
 if (!specifier.startsWith('./') && !specifier.startsWith('../')) return nextResolve(specifier, context);
 if (!context.parentURL?.startsWith('file:')) return nextResolve(specifier, context);
 const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
 for (const file of [base, base + '.ts', path.join(base, 'index.ts')]) if (existsSync(file) && statSync(file).isFile()) return { url:pathToFileURL(file).href, shortCircuit:true };
 return nextResolve(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const mock = await import('../mocks/data/rewards.ts');
const economy = await import('../mocks/data/economy-rules.ts');
const schemas = await import('@rescom/schemas');

test('(Story 12.1, AC3) seed: 7 vouchers, 4 categories, 6 brands, 1 active Flash, demo 186/18, 3 unused tickets', () => {
  const viewer = { available: 186, pending: 18 };
  const catalog = mock.catalogOf('user-active-002', viewer);
  assert.equal(catalog.items.length, 7);
  schemas.voucherCatalogSchema.parse(catalog);
  assert.equal(catalog.items.filter(item => item.affordable).length, 5);
  assert.equal(new Set(catalog.items.map(v => v.category)).size, 4);
  assert.equal(new Set(catalog.items.map(v => v.brand.id)).size, 6);
  const flash = schemas.flashSaleListSchema.parse(mock.flashSalesAt());
  assert.equal(flash.items.filter(f => f.items.some(i => i.state === 'ACTIVE')).length, 1);
  const rows = mock.rewardsState.get().users['user-active-002'];
  assert.equal(rows.tickets.filter(ticket => ['UNUSED', 'EXPIRING'].includes(ticket.status)).length, 3);
  rows.tickets.forEach(ticket => schemas.voucherTicketSchema.parse(ticket));
  rows.history.forEach(entry => schemas.redemptionHistoryEntrySchema.parse(entry));
  rows.issues.forEach(issue => schemas.codeIssueReportSchema.parse(issue));
});

test('(Story 12.1, AC4) filter, sort and pagination', () => {
  const viewer = { available: 186, pending: 18 };
  assert.deepEqual(mock.catalogOf('user-active-002', viewer, { category: ['TEA'], sort: 'POINTS_ASC' }).items.map(v => v.price.points), [100, 120]);
  const first = mock.catalogOf('user-active-002', viewer, { limit: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.total, 7);
  assert.equal(first.hasMore, true);
  assert.equal(mock.catalogOf('user-active-002', viewer, { affordable: true }).total, 5);
  assert.equal(mock.catalogOf('user-active-002', viewer, { onSale: true }).total, 3);
});

test('(Story 12.1, AC4) quote and redemption: idempotency via helpers, stock mutated once', () => {
  const user = 'test-rewards-unique';
  const voucherId = mock.catalogOf(user, { available: 300 }).items.find(v => v.price.points === 120).id;
  const quoteResult = mock.createVoucherQuote(user, voucherId, { available: 300 });
  assert.equal(quoteResult.ok, true);
  schemas.redemptionQuoteSchema.parse(quoteResult.result);
  const before = mock.voucherOf(voucherId, { available: 300 }).voucher.stockRemaining;
  const first = mock.redeemVoucherQuote(user, quoteResult.result.quoteId, { available: 300 }, Date.now(), 'key-one');
  assert.equal(first.ok, true);
  schemas.redemptionResultSchema.parse(first.result);
  assert.equal(mock.voucherOf(voucherId, { available: 300 }).voucher.stockRemaining, before - 1);
  // Replay: same key, same quoteId → replayed, stock unchanged
  const replay = mock.redeemVoucherQuote(user, quoteResult.result.quoteId, { available: 300 }, Date.now(), 'key-one');
  assert.equal(replay.replayed, true);
  assert.equal(mock.voucherOf(voucherId, { available: 300 }).voucher.stockRemaining, before - 1);
  // Poll by key
  assert.equal(mock.redemptionByKey(user, 'key-one').result.reference, first.result.reference);
  // Conflict: different quoteId, same key
  assert.equal(mock.redeemVoucherQuote(user, 'different-quote', { available: 300 }, Date.now(), 'key-one').code, 'IDEMPOTENCY_KEY_CONFLICT');
});

test('(Story 12.1, AC4) wallet journal: redemption: key maps to VOUCHER_REDEMPTION / Đổi voucher', () => {
  const ledger = economy.ledgerItemsFromRows('test-wallet', [{ id: '11111111-1111-4111-8111-111111111111', createdAt: new Date().toISOString(),
    kind: 'VOUCHER_REDEMPTION', amount: -120, status: 'AVAILABLE', note: 'Voucher trà sữa',
    surveyId: null, attemptId: null, releasesAt: null, redemptionKey: 'key-wallet' }]);
  assert.ok(ledger.some(row => row.idempotencyKey === 'redemption:key-wallet'));
});

test('(Story 12.1, AC4) forced errors: real details from state, failure leaves catalog unchanged, persists history+idempotency', () => {
  const codes = ['SOLD_OUT', 'PRICE_CHANGED', 'INSUFFICIENT_POINTS', 'VOUCHER_UNAVAILABLE', 'ACCOUNT_NOT_ELIGIBLE'];
  codes.forEach((code, index) => {
    const user = `test-error-v2-${index}`;
    // Use low balance so INSUFFICIENT_POINTS details reflect actual viewer state
    const balance = code === 'INSUFFICIENT_POINTS' ? 10 : 300;
    const quoteResult = mock.createVoucherQuote(user, mock.catalogOf(user, { available: 300 }).items[0].id, { available: 300 });
    assert.equal(quoteResult.ok, true);
    const catalogBefore = JSON.stringify(mock.rewardsCatalog.get());
    const result = mock.redeemVoucherQuote(user, quoteResult.result.quoteId, { available: balance }, Date.now(), `err-v2-${index}`, code);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    schemas.redemptionErrorSchema.parse({ code, message: code, details: result.details });
    // Catalog unchanged on failure (Task 5.6)
    assert.equal(JSON.stringify(mock.rewardsCatalog.get()), catalogBefore);
    const history = mock.rewardsState.get().users[user].history;
    assert.equal(history.length, 1);
    schemas.redemptionHistoryEntrySchema.parse(history[0]);
    // Replay returns same error
    assert.equal(mock.redeemVoucherQuote(user, quoteResult.result.quoteId, { available: balance }, Date.now(), `err-v2-${index}`, code).replayed, true);
    assert.equal(mock.rewardsState.get().users[user].history.length, 1);
    // INSUFFICIENT_POINTS details use actual viewer balance
    if (code === 'INSUFFICIENT_POINTS') assert.equal(result.details.available, 10);
  });
});
