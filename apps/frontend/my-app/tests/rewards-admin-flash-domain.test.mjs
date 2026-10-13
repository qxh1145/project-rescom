import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
const loader = `import {existsSync,statSync} from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';export function resolve(specifier,context,nextResolve){if(!specifier.startsWith('.')&&!specifier.startsWith('@/'))return nextResolve(specifier,context);const base=specifier.startsWith('@/')?path.resolve(${JSON.stringify(process.cwd())},specifier.slice(2)):path.resolve(path.dirname(new URL(context.parentURL).pathname),specifier);for(const file of [base,base+'.ts',path.join(base,'index.ts')])if(existsSync(file)&&statSync(file).isFile())return{url:pathToFileURL(file).href,shortCircuit:true};return nextResolve(specifier,context)}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const rules = await import('../mocks/data/rewards-rules.ts');
const data = await import('../mocks/data/rewards.ts');
const now = Date.now(), iso = offset => new Date(now + offset).toISOString();
const admin = { id: '00000000-0000-4000-8000-000000000999', name: 'Admin Hùng' };
const voucher = data.rewardsCatalog.get().vouchers[2];
const input = { title: 'Test Flash', startsAt: iso(2 * 86400000), endsAt: iso(2 * 86400000 + 3600000), rules: { requireRecentSurvey: true, remindBefore10m: true, blockFlagged: true }, items: [{ voucherId: voucher.id, flashPoints: 80, quota: 3, perUserCap: 1 }] };
test('five statuses and half-open boundary', () => {
  const f = { ...data.rewardsCatalog.get().flashes[0], startsAt: iso(3600000), endsAt: iso(7200000), items: [{ ...data.rewardsCatalog.get().flashes[0].items[0], sold: 0, quota: 2 }] };
  assert.equal(rules.adminFlashStatus(f, now), 'UPCOMING');
  assert.equal(rules.adminFlashStatus(f, now + 3600000), 'ACTIVE');
  assert.equal(rules.adminFlashStatus({ ...f, items: [{ ...f.items[0], sold: 2 }] }, now + 3600000), 'SOLD_OUT');
  assert.equal(rules.adminFlashStatus(f, now + 7200000), 'ENDED');
  assert.equal(rules.adminFlashStatus({ ...f, startsAt: iso(2 * 86400000) }, now), 'SCHEDULED');
  assert.equal(rules.adminFlashStatus({ ...f, endedEarlyAt: iso(3600000) }, now + 3600000), 'ENDED');
  assert.equal(rules.endEarlyDecision(f, now + 3600000).result.returned, 2);
});
test('Vietnam buckets distinguish midnight', () => {
  assert.deepEqual(rules.bucketByVietnamDay(['2026-10-13T16:30:00Z','2026-10-13T17:30:00Z']), { '2026-10-13': 1, '2026-10-14': 1 });
});
test('create reserves, edit restores old quota, settle once, and stats parse', async () => {
  const original = voucher.stockRemaining;
  const created = data.createAdminFlashSale(input, admin, now);
  assert.equal(created.ok, true);
  const id = created.result.flashSale.id;
  assert.equal(data.rewardsCatalog.get().vouchers.find(v => v.id === voucher.id).stockRemaining, original - 3);
  assert.equal(data.updateAdminFlashSale(id, { ...input, items: [{ ...input.items[0], quota: 4 }] }, now).ok, true);
  assert.equal(data.rewardsCatalog.get().vouchers.find(v => v.id === voucher.id).stockRemaining, original - 4);
  assert.equal(data.updateAdminFlashSale(id, input, now + 2 * 86400000).code, 'FLASH_ALREADY_STARTED');
  const settledAt = now + 3 * 86400000;
  data.adminFlashSalesOf({}, settledAt);
  data.adminFlashSalesOf({}, settledAt);
  assert.equal(data.rewardsCatalog.get().vouchers.find(v => v.id === voucher.id).stockRemaining, original);
  const schemas = await import('@rescom/schemas');
  assert.equal(schemas.adminFlashSaleListSchema.safeParse(data.adminFlashSalesOf({}, now).result).success, true);
  const stats = data.rewardsStatsOf({ from: rules.vietnamDayOf(now - 29 * 86400000), to: rules.vietnamDayOf(now) }, now);
  assert.equal(schemas.rewardsStatsSchema.safeParse(stats.result).success, true);
});
test('conflicts reject price, stock, overlap; touching windows allowed', () => {
  const v = { ...voucher, stockRemaining: 6, codesAvailable: 6, redeemEndsAt: iso(10 * 86400000) };
  const f = { ...data.rewardsCatalog.get().flashes[0], startsAt: iso(2 * 86400000 + 3600000), endsAt: iso(2 * 86400000 + 7200000), endedEarlyAt: null,
    items: [{ ...data.rewardsCatalog.get().flashes[0].items[0], voucherId: v.id, quota: 3, sold: 1 }] };
  assert.equal(rules.flashConflicts(input, [v], [f], now).some(c => c.code === 'FLASH_OVERLAP'), false);
  const overlaps = rules.flashConflicts({ ...input, endsAt: iso(2 * 86400000 + 5400000), items: [{ ...input.items[0], flashPoints: v.basePoints, quota: 7 }] }, [v], [f], now);
  assert.deepEqual(new Set(overlaps.map(c => c.code)), new Set(['FLASH_OVERLAP','FLASH_PRICE_NOT_BELOW_REGULAR','FLASH_QUOTA_EXCEEDS_STOCK']));
  assert.equal(rules.flashConflicts(input, [v], [{ ...f, endedEarlyAt: input.startsAt }], now).some(c => c.code === 'FLASH_OVERLAP'), false);
});
test('end early returns unsold once; existing quote price change does not charge', () => {
  const state = data.rewardsCatalog.get(), active = state.flashes.find(f => f.code === 'FS-1013-A'), item = active.items[0];
  const user = '00000000-0000-4000-8000-000000008888';
  const quote = data.createVoucherQuote(user, item.voucherId, { available: 1000 }, now);
  assert.equal(quote.ok, true);
  const before = state.vouchers.find(v => v.id === item.voucherId).stockRemaining;
  const ended = data.endAdminFlashSale(active.id, { reason: 'OTHER', note: 'Partner' }, now);
  assert.equal(ended.ok, true);
  assert.equal(data.rewardsCatalog.get().vouchers.find(v => v.id === item.voucherId).stockRemaining, before + item.quota - item.sold);
  assert.equal(data.endAdminFlashSale(active.id, { reason: 'OTHER', note: 'Partner' }, now).code, 'FLASH_ALREADY_ENDED');
  const redeemed = data.redeemVoucherQuote(user, quote.result.quoteId, { available: 1000 }, now + 1);
  assert.equal(redeemed.code, 'PRICE_CHANGED');
  assert.equal(data.rewardsState.get().users[user]?.tickets.length ?? 0, 0);
  assert.notEqual(rules.effectiveVoucherPrice(data.rewardsCatalog.get().vouchers.find(v => v.id === item.voucherId), data.rewardsCatalog.get().flashes, now + 1).price.source, 'FLASH');
});

// ---- Review follow-ups (Story 12.6 Task 7): isolated cases, store reset before each ----
const initialCatalog = structuredClone(data.rewardsCatalog.get()), initialUsers = structuredClone(data.rewardsState.get());
const reset = () => { data.rewardsCatalog.set(structuredClone(initialCatalog)); data.rewardsState.set(structuredClone(initialUsers)); };
const issuedMap = at => { const c = data.rewardsCatalog.get(); return Object.fromEntries(c.vouchers.map(v => [v.id, rules.adminStockOf(v, c.flashes, at).issued])); };
const base = () => data.rewardsCatalog.get().flashes.find(f => f.code === 'FS-1013-A');

test('seed reserves flash quota out of regular stock: issued is never negative', () => {
  reset();
  const c = data.rewardsCatalog.get();
  for (const v of c.vouchers) {
    const stock = rules.adminStockOf(v, c.flashes, now);
    assert.ok(stock.issued >= 0 && v.stockRemaining >= 0, `${v.title}: issued ${stock.issued}, remaining ${v.stockRemaining}`);
  }
  // Seed regular stock excludes every unsettled program's full quota (100/80/20/50 for vouchers 1/2/3/4, 50 for voucher 5 grows the pool).
  const stockOf = n => c.vouchers[n - 1];
  assert.deepEqual([1, 2, 3, 4].map(n => stockOf(n).stockRemaining), [80, 10, 84, 12]);
  assert.deepEqual([stockOf(5).stockTotal, stockOf(5).stockRemaining], [130, 9]);
  // Ending the active seed program returns exactly its unsold part, never more.
  const before = issuedMap(now);
  assert.equal(data.endAdminFlashSale(base().id, { reason: 'WRONG_PRICE' }, now).ok, true);
  assert.deepEqual(issuedMap(now), before);
  assert.deepEqual([1, 2, 5].map(n => data.rewardsCatalog.get().vouchers[n - 1].stockRemaining), [80 + 25, 10 + 32, 9 + 0]);
});

test('create, update, end and settle keep issued unchanged for every voucher', () => {
  reset();
  const before = issuedMap(now);
  const created = data.createAdminFlashSale(input, admin, now);
  assert.deepEqual(issuedMap(now), before);
  assert.equal(data.updateAdminFlashSale(created.result.flashSale.id, { ...input, items: [{ ...input.items[0], quota: 5 }] }, now).ok, true);
  assert.deepEqual(issuedMap(now), before);
  assert.equal(data.endAdminFlashSale(base().id, { reason: 'STOCK_ISSUE' }, now).ok, true);
  assert.deepEqual(issuedMap(now), before);
  data.adminFlashSalesOf({}, now + 8 * 86400000);
  const c = data.rewardsCatalog.get();
  for (const v of c.vouchers) { const s = rules.adminStockOf(v, c.flashes, now + 8 * 86400000); assert.ok(s.issued >= 0); assert.equal(s.flashReserved, 0); }
});

test('create settles ended programs first: no false FLASH_QUOTA_EXCEEDS_STOCK', () => {
  reset();
  const v = data.rewardsCatalog.get().vouchers.find(x => x.id === base().items[0].voucherId);
  const later = now + 4 * 3600000; // FS-1013-A (quota 100 on this voucher) ended by then and is not settled yet
  const wanted = v.stockRemaining + 25; // exactly the unsold part of the ended program (100 - 75)
  const result = data.createAdminFlashSale({ ...input, startsAt: iso(5 * 3600000 + 86400000), endsAt: iso(6 * 3600000 + 86400000), items: [{ voucherId: v.id, flashPoints: 80, quota: wanted, perUserCap: 1 }] }, admin, later);
  assert.equal(result.ok, true, JSON.stringify(result.details));
});

test('flash codes stay unique within a start day', () => {
  reset();
  const codes = [1, 2, 3].map(n => data.createAdminFlashSale({ ...input, items: [{ ...input.items[0], quota: 1 }], startsAt: iso(2 * 86400000 + n * 7200000), endsAt: iso(2 * 86400000 + n * 7200000 + 3600000) }, admin, now).result.flashSale.code);
  assert.equal(new Set(codes).size, 3);
  assert.ok(codes.every(code => /^FS-\d{4}-[A-Z]$/.test(code)));
});

test('conflict codes: starts in past, not flashable, quota below sold', () => {
  const v = { ...voucher, state: 'ACTIVE', isVisible: true, isSharedCode: false, stockRemaining: 50, codesAvailable: 50, redeemStartsAt: iso(-86400000), redeemEndsAt: iso(10 * 86400000) };
  const codesOf = (vv, i = input, flashes = [], self) => rules.flashConflicts(i, [vv], flashes, now, self).map(c => c.code);
  assert.ok(codesOf(v, { ...input, startsAt: iso(-1000) }).includes('FLASH_STARTS_IN_PAST'));
  assert.ok(codesOf(v, { ...input, startsAt: iso(0), endsAt: iso(3600000) }).includes('FLASH_STARTS_IN_PAST'));
  for (const bad of [{ state: 'PAUSED' }, { state: 'ARCHIVED' }, { isVisible: false }, { redeemEndsAt: iso(3600000) }, { isSharedCode: true, stockRemaining: 0 }])
    assert.ok(codesOf({ ...v, ...bad }).includes('VOUCHER_NOT_FLASHABLE'), JSON.stringify(bad));
  assert.deepEqual(codesOf(v), []);
  const own = { ...base(), startsAt: input.startsAt, endsAt: input.endsAt, items: [{ ...base().items[0], voucherId: v.id, quota: 5, sold: 3 }] };
  const below = rules.flashConflicts({ ...input, items: [{ ...input.items[0], quota: 2 }] }, [v], [own], now, own.id).find(c => c.code === 'FLASH_QUOTA_BELOW_SOLD');
  assert.equal(below.details.sold, 3);
  assert.equal(below.path, 'items.0.quota');
});

test('flashProgress: rate, ETA vs no ETA, sell-out time is real and does not decay', () => {
  const start = now - 10 * 60000;
  const flash = { ...base(), startsAt: new Date(start).toISOString(), endsAt: iso(3600000), endedEarlyAt: null,
    items: [{ id: 'a', voucherId: 'v', flashPoints: 1, quota: 100, sold: 20, perUserCap: 1 }, { id: 'b', voucherId: 'v', flashPoints: 1, quota: 100, sold: 0, perUserCap: 1 },
      { id: 'c', voucherId: 'v', flashPoints: 1, quota: 10, sold: 10, perUserCap: 1, soldOutAt: new Date(start + 5 * 60000).toISOString() }] };
  const [fast, none, out] = rules.flashProgress(flash, now);
  assert.equal(fast.perMinute, 2);
  assert.equal(Date.parse(fast.etaAt), now + 40 * 60000);
  assert.equal(none.etaAt, null);
  assert.equal(out.etaAt, null);
  assert.equal(out.soldOutAt, new Date(start + 5 * 60000).toISOString());
  assert.equal(out.perMinute, 2);
  assert.equal(rules.flashProgress(flash, now + 30 * 60000)[2].perMinute, 2);
  assert.equal(rules.flashProgress({ ...flash, endedEarlyAt: new Date(start + 20 * 60000).toISOString() }, now + 30 * 60000)[0].perMinute, 1);
});

test('seed carries realistic flash metadata and real sell-out times', () => {
  reset();
  const rows = data.adminFlashSalesOf({}, now).result.items;
  const upcoming = rows.find(f => f.status === 'UPCOMING'), ended = rows.filter(f => f.status === 'ENDED');
  assert.ok(upcoming.remindCount > 0);
  assert.ok(ended.length >= 2 && ended.every(f => f.participants > 0));
  const soldOutItem = rows.find(f => f.code === 'FS-1013-A').items.find(i => i.sold >= i.quota);
  assert.ok(soldOutItem.soldOutAt);
  assert.ok(rows.find(f => f.code === 'FS-1013-A').items.filter(i => i.sold < i.quota).every(i => i.soldOutAt === null));
});

test('stats: daily fills every day, flash days only for started programs', () => {
  reset();
  const range = { from: rules.vietnamDayOf(now - 29 * 86400000), to: rules.vietnamDayOf(now) };
  const stats = data.rewardsStatsOf(range, now).result;
  assert.equal(stats.daily.length, 30);
  const upcomingCode = 'FS-1013-B';
  assert.ok(!stats.flashSales.some(f => f.code === upcomingCode));
  assert.ok(!stats.daily.some(d => d.flashSaleCodes.includes(upcomingCode)));
  const flashDays = stats.daily.filter(d => d.flashSaleCodes.length);
  assert.ok(flashDays.every(d => d.count > stats.kpis.redemptions.avgPerRegularDay * 2));
  assert.ok(stats.kpis.redemptions.avgPerRegularDay > 0 && stats.kpis.redemptions.avgPerRegularDay < flashDays[0].count);
  assert.equal(stats.kpis.pointsSpent.vndEquivalent, stats.kpis.pointsSpent.points * 200);
  assert.ok(stats.kpis.redemptionRate.rate <= 1 && stats.kpis.redemptionRate.offered >= stats.kpis.redemptionRate.redeemed);
  const sold = stats.flashSales.find(f => f.code === 'FS-0928-A');
  assert.equal(sold.soldOutAfterMinutes, 38);
});

test('stats: a live ticket after seededAt raises the day and top share; a refund removes it; reference dedupes clones', () => {
  reset();
  const range = { from: rules.vietnamDayOf(now - 29 * 86400000), to: rules.vietnamDayOf(now + 10000) };
  const at = now + 10000, before = data.rewardsStatsOf(range, at).result;
  const topId = before.kpis.topVoucher.voucherId;
  const ticket = { ...structuredClone(data.rewardsState.get().users['user-active-002'].tickets[0]), id: 'live-t', redemptionId: 'live-r', reference: 'RDM-LIVE-0001', voucherId: topId, redeemedAt: iso(5000), pointsSpent: 200, usedAt: null, openIssue: null };
  data.rewardsState.update(draft => { draft.users['user-active-002'].tickets.push(ticket); draft.users['00000000-0000-4000-8000-00000000d001'].tickets.push({ ...ticket }); });
  const after = data.rewardsStatsOf(range, at).result;
  const today = rules.vietnamDayOf(at);
  assert.equal(after.kpis.redemptions.count, before.kpis.redemptions.count + 1);
  assert.equal(after.daily.find(d => d.date === today).count, before.daily.find(d => d.date === today).count + 1);
  assert.equal(after.kpis.pointsSpent.points, before.kpis.pointsSpent.points + 200);
  assert.equal(after.kpis.topVoucher.count, before.kpis.topVoucher.count + 1);
  assert.ok(Math.abs(after.kpis.topVoucher.share - after.kpis.topVoucher.count / after.kpis.redemptions.count) < 1e-9);
  data.rewardsState.update(draft => { draft.users['user-active-002'].issues.push({ id: 'i1', redemptionId: 'live-r', ticketId: 'live-t', reason: 'CODE_INVALID', note: null, status: 'REFUNDED', createdAt: iso(6000), resolvedAt: iso(7000), replacementCode: null, refundReference: 'RFD-1' }); });
  assert.equal(data.rewardsStatsOf(range, at).result.kpis.redemptions.count, before.kpis.redemptions.count);
});

test('stats: empty and future ranges give finite zeros and a valid range', async () => {
  reset();
  const schemas = await import('@rescom/schemas');
  const empty = data.rewardsStatsOf({ from: '2020-01-01', to: '2020-01-07' }, now).result;
  assert.equal(empty.kpis.redemptions.count, 0);
  assert.equal(empty.kpis.redemptions.avgPerRegularDay, 0);
  assert.equal(empty.kpis.redemptionRate.rate, 0);
  assert.equal(empty.kpis.topVoucher, null);
  assert.equal(empty.kpis.selfReportedUsageRate, 0);
  assert.equal(empty.daily.length, 7);
  assert.ok(!JSON.stringify(empty).includes('NaN') && [empty.kpis.redemptions.avgPerRegularDay, empty.kpis.redemptionRate.rate, empty.kpis.selfReportedUsageRate].every(Number.isFinite));
  assert.equal(schemas.rewardsStatsSchema.safeParse(empty).success, true);
  const future = data.rewardsStatsOf({ from: '2999-01-01', to: '2999-02-01' }, now).result;
  assert.ok(future.range.from <= future.range.to);
  assert.equal(schemas.rewardsStatsSchema.safeParse(future).success, true);
  assert.equal(schemas.rewardsStatsQuerySchema.safeParse({ from: '2020-01-01', to: '2021-01-02' }).success, false);
  assert.equal(schemas.adminFlashSaleInputSchema.safeParse({ ...input, startsAt: '2026-10-01T03:00:00.000Z', endsAt: '2026-10-01T03:00:00Z' }).success, false);
});
