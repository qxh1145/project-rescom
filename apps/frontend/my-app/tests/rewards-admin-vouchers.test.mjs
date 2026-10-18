import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminStockOf, adminVoucherStatus, priceDeviationPercent, validateVoucherInput, stockAdjustmentDecision, importCodesDecision } from '../mocks/data/rewards-rules.ts';


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
const { adminVouchersOf, adminVoucherDetailOf, createAdminVoucher, changeAdminVoucherPrice, adjustAdminVoucherStock, importAdminVoucherCodes, patchAdminVoucherState, updateAdminVoucher, rewardsCatalog, rewardsState } = await import('../mocks/data/rewards.ts');

const now = Date.now(), iso = offset => new Date(now + offset).toISOString();
const voucher = { id: 'test', state: 'ACTIVE', isVisible: true, stockTotal: 20, stockRemaining: 10, codesAvailable: 10, isSharedCode: false, redeemStartsAt: iso(-10000), redeemEndsAt: iso(100000) };
const flashes = [{ endsAt: iso(10000), endedEarlyAt: null, items: [{ voucherId: 'test', quota: 7, sold: 2 }] }];

test('admin stock subtracts outstanding flash quota; ended flashes release reservation', () => {
  assert.deepEqual(adminStockOf(voucher, flashes, now), { total: 20, issued: 5, flashReserved: 5, remaining: 10, codesAvailable: 10 });
  assert.equal(adminStockOf(voucher, flashes, now + 10000).flashReserved, 0);
  assert.equal(stockAdjustmentDecision(voucher, adminStockOf(voucher, flashes, now), 9).code, 'STOCK_BELOW_COMMITTED');
  assert.equal(stockAdjustmentDecision(voucher, adminStockOf(voucher, flashes, now), 21).code, 'STOCK_INCREASE_NEEDS_CODES');
  assert.equal(stockAdjustmentDecision({ ...voucher, isSharedCode: true }, adminStockOf(voucher, flashes, now), 21).ok, true);
  assert.equal(stockAdjustmentDecision({ ...voucher, codesAvailable: 2 }, adminStockOf({ ...voucher, codesAvailable: 2 }, flashes, now), 15).code, 'STOCK_EXCEEDS_CODES');
});

test('admin derived status priority and price deviation', () => {
  assert.equal(adminVoucherStatus({ ...voucher, state: 'ARCHIVED', isVisible: false }, [], now), 'ARCHIVED');
  assert.equal(adminVoucherStatus({ ...voucher, isVisible: false }, [], now), 'HIDDEN');
  assert.equal(adminVoucherStatus({ ...voucher, state: 'PAUSED' }, [], now), 'PAUSED');
  assert.equal(adminVoucherStatus({ ...voucher, redeemEndsAt: iso(-1) }, [], now), 'EXPIRED');
  assert.equal(adminVoucherStatus({ ...voucher, codesAvailable: 0 }, [], now), 'SOLD_OUT');
  assert.equal(adminVoucherStatus(voucher, [], now), 'ACTIVE');
  assert.equal(priceDeviationPercent(50000, 300), 20);
  assert.equal(priceDeviationPercent(50000, 250), 0);
  assert.equal(priceDeviationPercent(50000, 400), 60);
});

test('admin input brand, ended edit and shared flag rules', () => {
  assert.equal(validateVoucherInput({ brandId: 'bogus', redeemEndsAt: iso(10000), isSharedCode: false })[0].code, 'BRAND_NOT_FOUND');
  assert.equal(validateVoucherInput({ brandId: 'highlands', redeemEndsAt: iso(-1), isSharedCode: true }, { voucher, issued: 1, now }).length, 2);
});

test('code import rejects entire file on duplicates; comparisons trim and preserve case', () => {
  assert.deepEqual(importCodesDecision(['AA01 ', 'AA01', 'aa01', 'OLD1'], ['OLD1']), { received: 4, accepted: 0, duplicatesInFile: ['AA01'], alreadyStored: ['OLD1'], committed: false });
  assert.equal(importCodesDecision(['AA01', 'aa01'], []).accepted, 2);
});

test('seven seed inventories have nonnegative issued count', () => {
  const { vouchers, flashes } = rewardsCatalog.get();
  for (const item of vouchers) assert.ok(adminStockOf(item, flashes, now).issued >= 0, item.id);
  assert.equal(adminVouchersOf().summary.total, vouchers.length);
});

test('admin create/import/price/stock/archive mutate catalog but preserve redeemed ticket prices', () => {
  const input = { title: 'Voucher test', brandId: 'highlands', category: 'COFFEE', valueVnd: 50000, basePoints: 250, promoPoints: null,
    isSharedCode: false, redeemStartsAt: iso(-1000), redeemEndsAt: iso(10 * 86400000), codeExpiresAt: iso(20 * 86400000), terms: [], howToUse: [], imageUrl: null };
  const admin = { id: '00000000-0000-4000-8000-000000000001', name: 'Admin Hùng' };
  const created = createAdminVoucher(input, admin, now);
  assert.equal(created.ok, true);
  const id = created.result.voucher.id;
  assert.equal(created.result.voucher.stock.remaining, 0);
  assert.equal(importAdminVoucherCodes(id, { codes: ['TEST1', 'TEST2'], mode: 'VALIDATE' }).result.committed, false);
  assert.equal(rewardsCatalog.get().codePools[id].length, 0);
  assert.equal(importAdminVoucherCodes(id, { codes: ['TEST1', 'TEST2'], mode: 'COMMIT' }).result.committed, true);
  assert.equal(importAdminVoucherCodes(id, { codes: ['TEST1'], mode: 'COMMIT' }).result.accepted, 0);
  assert.equal(changeAdminVoucherPrice(id, { basePoints: 300, promoPoints: null }, admin, now).result.voucher.price.priceVersion, 2);
  assert.equal(adminVoucherDetailOf(id).result.priceHistory.length, 2);
  assert.equal(adjustAdminVoucherStock(id, { total: 1, reason: 'Reduce inventory' }).result.voucher.stock.codesAvailable, 1);
  assert.equal(rewardsCatalog.get().codePools[id].length, 1);
  assert.equal(patchAdminVoucherState(id, { state: 'ARCHIVED' }).result.voucher.state, 'ARCHIVED');
  assert.equal(importAdminVoucherCodes(id, { codes: ['TEST3'], mode: 'COMMIT' }).code, 'VOUCHER_ARCHIVED');
  assert.ok(Object.values(rewardsState.get().users).flatMap(u => u.tickets).every(t => t.pointsSpent > 0));
});

test('imported code redeemed once; issued rises, old quote fails on price change, paused voucher cannot quote', async () => {
  const { createVoucherQuote, redeemVoucherQuote, catalogOf } = await import('../mocks/data/rewards.ts');
  const input = { title: 'Voucher lifecycle', brandId: 'highlands', category: 'COFFEE', valueVnd: 50000, basePoints: 250, promoPoints: null,
    isSharedCode: false, redeemStartsAt: iso(-1000), redeemEndsAt: iso(10 * 86400000), codeExpiresAt: iso(20 * 86400000), terms: [], howToUse: [], imageUrl: null };
  const admin = { id: '00000000-0000-4000-8000-000000000001', name: 'Admin Hùng' };
  const id = createAdminVoucher(input, admin, now).result.voucher.id;
  const user = '00000000-0000-4000-8000-000000000009', viewer = { available: 1000 };
  assert.equal(importAdminVoucherCodes(id, { codes: ['LIFE1', 'LIFE2'], mode: 'COMMIT' }).result.committed, true);
  assert.equal(adjustAdminVoucherStock(id, { total: 3, reason: 'Increase inventory' }).code, 'STOCK_INCREASE_NEEDS_CODES');
  const oldQuote = createVoucherQuote(user, id, viewer, now);
  assert.equal(oldQuote.ok, true);
  assert.equal(changeAdminVoucherPrice(id, { basePoints: 300, promoPoints: null }, admin, now).ok, true);
  assert.equal(redeemVoucherQuote(user, oldQuote.result.quoteId, viewer, now).code, 'PRICE_CHANGED');
  const fresh = createVoucherQuote(user, id, viewer, now);
  assert.equal(fresh.ok, true);
  const redeemed = redeemVoucherQuote(user, fresh.result.quoteId, viewer, now);
  assert.equal(redeemed.ok, true);
  assert.equal(redeemed.result.ticket.code, 'LIFE1');
  assert.equal(redeemed.result.ticket.pointsSpent, 300);
  assert.equal(adminVoucherDetailOf(id, now).result.voucher.stock.issued, 1);
  assert.equal(rewardsCatalog.get().codePools[id].length, 1);
  assert.equal(adminVoucherDetailOf(id, now).result.redemptions.length, 1);
  assert.equal(adjustAdminVoucherStock(id, { total: 0, reason: 'Cannot remove sold code' }).code, 'STOCK_BELOW_COMMITTED');
  assert.equal(patchAdminVoucherState(id, { state: 'PAUSED' }).ok, true);
  assert.equal(adminVouchersOf({ filter: 'PAUSED' }).items.some(v => v.id === id), true);
  assert.equal(catalogOf(user, viewer).items.find(v => v.id === id)?.status, 'PAUSED');
  assert.equal(createVoucherQuote(user, id, viewer, now).code, 'VOUCHER_UNAVAILABLE');
});

test('shared-code voucher refuses imported individual codes', () => {
  const input = { title: 'Voucher shared', brandId: 'highlands', category: 'COFFEE', valueVnd: 50000, basePoints: 250, promoPoints: null,
    isSharedCode: true, redeemStartsAt: iso(-1000), redeemEndsAt: iso(10 * 86400000), codeExpiresAt: iso(20 * 86400000), terms: [], howToUse: [], imageUrl: null };
  const id = createAdminVoucher(input, { id: '00000000-0000-4000-8000-000000000001', name: 'Admin Hùng' }, now).result.voucher.id;
  assert.equal(importAdminVoucherCodes(id, { codes: ['SHARED1'], mode: 'COMMIT' }).code, 'SHARED_CODE_VOUCHER');
  assert.equal(adjustAdminVoucherStock(id, { total: 2, reason: 'Shared allocation' }).result.voucher.stock.total, 2);
});


test('edit preserves unavailable metadata when detail contract omits it', () => {
  const input = { title: 'Keep metadata', brandId: 'highlands', category: 'COFFEE', valueVnd: 50000, basePoints: 250, promoPoints: null,
    isSharedCode: false, redeemStartsAt: iso(-1000), redeemEndsAt: iso(10 * 86400000), codeExpiresAt: iso(20 * 86400000),
    terms: ['Original terms'], howToUse: ['Original steps'], imageUrl: 'https://example.com/image.png' };
  const id = createAdminVoucher(input, { id: '00000000-0000-4000-8000-000000000001', name: 'Admin Hùng' }, now).result.voucher.id;
  assert.equal(updateAdminVoucher(id, { ...input, title: 'Edited title', terms: [], howToUse: [], imageUrl: null }, now).ok, true);
  const stored = rewardsCatalog.get().vouchers.find(v => v.id === id);
  assert.equal(stored.title, 'Edited title');
  assert.deepEqual(stored.terms, ['Original terms']);
  assert.deepEqual(stored.howToUse, ['Original steps']);
  assert.equal(stored.imageUrl, 'https://example.com/image.png');
});


test('detail joins redemptions by ticket only: seed history without a ticket never leaks onto same-name vouchers', () => {
  const coffee = rewardsCatalog.get().vouchers.find(v => v.brand.id === 'the-coffee-house');
  const rows = adminVoucherDetailOf(coffee.id, now).result.redemptions;
  assert.ok(rows.some(row => row.reference === 'RDM-2610-5TC1')); // Story 12.12 links existing refund to its missing ticket.
  assert.ok(rows.every(row => Object.values(rewardsState.get().users).some(user => user.tickets.some(ticket => ticket.reference === row.reference && ticket.voucherId === coffee.id))));
});

test('voucher handlers enforce session, admin role, CSRF and body schema', async () => {
  const { getResponse } = await import('msw');
  globalThis.window = { location: { search: '?msw=default' }, localStorage: null };
  const { rewardsAdminHandlers } = await import('../mocks/handlers/rewards-admin.ts');
  const { resetStore, loadStore, setCurrentUserId, setMockStorage } = await import('../mocks/legacy/store.ts');
  const { mockRepository } = await import('../mocks/legacy/repository.ts');
  mockRepository.setLatency(0);
  const original = loadStore().currentUserId;
  const saved = new Map();
  setMockStorage({ getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) });
  const call = async (method, route, body, csrf = true) => {
    const response = await getResponse(rewardsAdminHandlers, new Request(`http://localhost/api/admin/rewards/${route}`, {
      method, headers: { ...(csrf ? { 'X-CSRF-Token': 'test' } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), { baseUrl: 'http://localhost' });
    assert.ok(response);
    return { status: response.status, body: await response.json() };
  };
  try {
    resetStore();
    setCurrentUserId(null);
    assert.equal((await call('GET', 'vouchers')).status, 401);
    setCurrentUserId('user-new-001');
    const nonAdmin = await call('GET', 'vouchers');
    assert.equal(nonAdmin.status, 403);
    assert.equal(nonAdmin.body.error.code, 'FORBIDDEN_RESOURCE');
    setCurrentUserId('user-admin-004');
    const noCsrf = await call('POST', 'vouchers', {}, false);
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.body.error.code, 'AUTH_INVALID_CSRF_TOKEN');
    const invalid = await call('POST', 'vouchers', {});
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
    assert.ok(invalid.body.error.details);
  } finally {
    setMockStorage(null);
    setCurrentUserId(original);
    delete globalThis.window;
  }
});

test('rewards settings handlers serve the shared schema with session, admin role, CSRF and body checks', async () => {
  const { getResponse } = await import('msw');
  const { rewardsSettingsSchema } = await import('@rescom/schemas');
  globalThis.window = { location: { search: '?msw=default' }, localStorage: null };
  const { rewardsAdminHandlers } = await import('../mocks/handlers/rewards-admin.ts');
  const { resetStore, loadStore, setCurrentUserId, setMockStorage } = await import('../mocks/legacy/store.ts');
  const { mockRepository } = await import('../mocks/legacy/repository.ts');
  const { rewardsSettings } = await import('../mocks/data/rewards.ts');
  mockRepository.setLatency(0);
  const original = loadStore().currentUserId;
  const saved = new Map();
  setMockStorage({ getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) });
  const call = async (method, body, csrf = true) => {
    const response = await getResponse(rewardsAdminHandlers, new Request('http://localhost/api/admin/rewards/settings', {
      method, headers: { ...(csrf ? { 'X-CSRF-Token': 'test' } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), { baseUrl: 'http://localhost' });
    assert.ok(response);
    return { status: response.status, body: await response.json() };
  };
  const before = rewardsSettings.get();
  try {
    resetStore();
    setCurrentUserId(null);
    assert.equal((await call('GET')).status, 401);
    setCurrentUserId('user-new-001');
    const nonAdmin = await call('GET');
    assert.equal(nonAdmin.status, 403);
    assert.equal(nonAdmin.body.error.code, 'FORBIDDEN_RESOURCE');
    setCurrentUserId('user-admin-004');
    const read = await call('GET');
    assert.equal(read.status, 200);
    assert.equal(rewardsSettingsSchema.parse(read.body.data).dailyPointsLimit, before.dailyPointsLimit);
    const noCsrf = await call('PUT', { dailyPointsLimit: 800 }, false);
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.body.error.code, 'AUTH_INVALID_CSRF_TOKEN');
    for (const dailyPointsLimit of [0, 1_000_001, 1.5, '800']) {
      const invalid = await call('PUT', { dailyPointsLimit });
      assert.equal(invalid.status, 400, String(dailyPointsLimit));
      assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
      assert.ok(invalid.body.error.details);
    }
    const updated = await call('PUT', { dailyPointsLimit: 800 });
    assert.equal(updated.status, 200);
    assert.deepEqual(rewardsSettingsSchema.parse(updated.body.data), { dailyPointsLimit: 800 });
    assert.equal((await call('GET')).body.data.dailyPointsLimit, 800);
  } finally {
    rewardsSettings.set(before);
    setMockStorage(null);
    setCurrentUserId(original);
    delete globalThis.window;
  }
});

test('voucher service exports guard pilot build; admin voucher components avoid direct mocks', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const service = readFileSync(new URL('../lib/admin/rewards-vouchers-service.ts', import.meta.url), 'utf8');
  const exports = service.split(/export function /).slice(1);
  assert.ok(exports.length > 0);
  for (const entry of exports) assert.match(entry, /if \(!REWARDS_ENABLED\)/);
  const scan = dir => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(item.name + (item.isDirectory() ? '/' : ''), dir);
      if (item.isDirectory()) scan(url);
      else if (/\.(tsx?|jsx?)$/.test(item.name)) assert.doesNotMatch(readFileSync(url, 'utf8'), /(?:from|import\s*\()\s*['"][^'"]*mocks\//, url.href);
    }
  };
  scan(new URL('../app/(signed-in)/(admin)/admin/vouchers/', import.meta.url));
});

test('shared-code voucher can lower stock and is not sold out for lack of codes', () => {
  const input = { title: 'Shared decrease', brandId: 'highlands', category: 'COFFEE', valueVnd: 50000, basePoints: 250, promoPoints: null,
    isSharedCode: true, redeemStartsAt: iso(-1000), redeemEndsAt: iso(10 * 86400000), codeExpiresAt: iso(20 * 86400000), terms: [], howToUse: [], imageUrl: null };
  const id = createAdminVoucher(input, { id: '00000000-0000-4000-8000-000000000001', name: 'Admin Hùng' }, now).result.voucher.id;
  assert.equal(adjustAdminVoucherStock(id, { total: 3, reason: 'Shared allocation' }, now).ok, true);
  const lowered = adjustAdminVoucherStock(id, { total: 1, reason: 'Shared decrease' }, now);
  assert.equal(lowered.result.voucher.stock.total, 1);
  assert.equal(lowered.result.voucher.status, 'ACTIVE');
});

test('editing an ended voucher is allowed when redeemEndsAt is unchanged', () => {
  const v = { ...voucher, redeemEndsAt: iso(-5000) };
  assert.deepEqual(validateVoucherInput({ brandId: 'highlands', redeemEndsAt: v.redeemEndsAt, isSharedCode: false }, { voucher: v, issued: 0, now }), []);
  assert.equal(validateVoucherInput({ brandId: 'highlands', redeemEndsAt: iso(-1000), isSharedCode: false }, { voucher: v, issued: 0, now })[0].code, 'REDEMPTION_WINDOW_ENDED');
});

test('archived voucher is hidden from the user catalog and stock decrease trims the pool end', async () => {
  const { catalogOf } = await import('../mocks/data/rewards.ts');
  const input = { title: 'Archive me', brandId: 'highlands', category: 'COFFEE', valueVnd: 50000, basePoints: 250, promoPoints: null,
    isSharedCode: false, redeemStartsAt: iso(-1000), redeemEndsAt: iso(10 * 86400000), codeExpiresAt: iso(20 * 86400000), terms: [], howToUse: [], imageUrl: null };
  const id = createAdminVoucher(input, { id: '00000000-0000-4000-8000-000000000001', name: 'Admin Hùng' }, now).result.voucher.id;
  importAdminVoucherCodes(id, { codes: ['KEEP1', 'KEEP2', 'DROP3'], mode: 'COMMIT' }, now);
  assert.equal(adjustAdminVoucherStock(id, { total: 2, reason: 'Trim pool tail' }, now).ok, true);
  assert.deepEqual(rewardsCatalog.get().codePools[id], ['KEEP1', 'KEEP2']);
  patchAdminVoucherState(id, { state: 'ARCHIVED' }, now);
  assert.equal(adminVoucherDetailOf(id, now).result.voucher.status, 'ARCHIVED');
  assert.equal(catalogOf('00000000-0000-4000-8000-000000000009', { available: 1000 }).items.some(v => v.id === id), false);
});
