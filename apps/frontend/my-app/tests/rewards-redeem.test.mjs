import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ApiError } from '../lib/api/api-error.ts';
import { classifyRedeemFailure, pollRedemptionByKey, redeemErrorView, failedView, tweenValue, confirmPriceLabel, flashEndsLine, shouldSubmitRequote } from '../lib/rewards/redeem-flow.ts';
import { forcedError } from '../mocks/data/rewards-rules.ts';
import { REDEMPTION_ERROR_CODES, REDEMPTION_ERROR_HTTP_STATUS, accountNotEligibleReasonSchema } from '@rescom/schemas';

const now = Date.now();
const voucher = { id: '00000000-0000-4000-8000-000000000001', basePoints: 250, promoPoints: null, priceVersion: 1, stockRemaining: 10, codesAvailable: 5, state: 'ACTIVE', isVisible: true, redeemStartsAt: new Date(now - 10000).toISOString(), redeemEndsAt: new Date(now + 1000000).toISOString() };
const flashes = [{ id: '00000000-0000-4000-8000-000000000002', startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 60000).toISOString(), endedEarlyAt: null, items: [{ id: '00000000-0000-4000-8000-000000000003', voucherId: voucher.id, flashPoints: 150, quota: 10, sold: 0 }] }];
const http = (code, details, status = REDEMPTION_ERROR_HTTP_STATUS[code] ?? 404) => new ApiError({ kind: 'http', status, code, message: code, details });
const domain = (code) => { const out = forcedError(code, voucher, flashes, 186, now); return http(out.code, out.details); };
const ctx = { priceSource: 'FLASH', availableBefore: 186, quotePoints: 90 };

test('domain failures parse mock details; only uncertain outcomes are unknown', () => {
  for (const code of REDEMPTION_ERROR_CODES) { const out = classifyRedeemFailure(domain(code)); assert.equal(out.kind, 'rejected', code); assert.equal(out.error.code, code); }
  for (const error of [new ApiError({ kind: 'network', message: 'offline' }), new ApiError({ kind: 'malformed', message: 'bad' }), http('SERVER_ERROR', {}, 503)]) assert.equal(classifyRedeemFailure(error).kind, 'unknown');
  for (const error of [http('VOUCHER_NOT_FOUND', {}), http('SOLD_OUT', {}), new Error('broken')]) assert.equal(classifyRedeemFailure(error).kind, 'failed');
});

test('poll delays and early success, rejection, exhaustion and abort', async () => {
  const controller = new AbortController(), delays = [], attempts = [];
  const sleep = async (ms) => { delays.push(ms); };
  const good = { redemptionId: 'ok' };
  const result = await pollRedemptionByKey({ sleep, signal: controller.signal, onAttempt: n => attempts.push(n), fetchByKey: async () => attempts.length === 1 ? Promise.reject(http('REDEMPTION_NOT_FOUND', {})) : good });
  assert.deepEqual(result, { kind: 'succeeded', result: good }); assert.deepEqual(delays, [2000, 4000]); assert.deepEqual(attempts, [1, 2]);
  const rejected = await pollRedemptionByKey({ sleep, signal: controller.signal, onAttempt() {}, fetchByKey: async () => { throw domain('SOLD_OUT'); } });
  assert.equal(rejected.kind, 'rejected');
  delays.length = 0;
  const unresolved = await pollRedemptionByKey({ sleep, signal: controller.signal, onAttempt() {}, fetchByKey: async () => { throw http('REDEMPTION_NOT_FOUND', {}); } });
  assert.deepEqual(unresolved, { kind: 'unresolved' }); assert.deepEqual(delays, [2000, 4000, 8000]);
  const retryNetwork = await pollRedemptionByKey({ sleep, signal: controller.signal, onAttempt() {}, fetchByKey: async () => { throw new ApiError({ kind: 'network', message: 'offline' }); } });
  assert.deepEqual(retryNetwork, { kind: 'unresolved' });
  controller.abort();
  await assert.rejects(pollRedemptionByKey({ sleep, signal: controller.signal, onAttempt() {}, fetchByKey: async () => good }));
});

test('error views include safe copy and one next action', () => {
  for (const code of REDEMPTION_ERROR_CODES) {
    const parsed = classifyRedeemFailure(domain(code)); assert.equal(parsed.kind, 'rejected');
    const view = redeemErrorView(parsed.error, ctx);
    assert.match(view.body, /bạn chưa bị trừ điểm/i); assert.ok(view.primary.label); assert.ok(view.primary.target);
  }
  for (const reason of accountNotEligibleReasonSchema.options) {
    const view = redeemErrorView({ code: 'ACCOUNT_NOT_ELIGIBLE', message: '', details: { reason } }, ctx);
    assert.match(view.body, /bạn chưa bị trừ điểm/i); assert.ok(view.primary.label);
  }
  for (const status of ['PAUSED', 'EXPIRED', 'HIDDEN', 'ARCHIVED']) assert.match(redeemErrorView({ code: 'VOUCHER_UNAVAILABLE', message: '', details: { status, voucherId: voucher.id } }, ctx).body, /bạn chưa bị trừ điểm/i);
  for (const kind of ['failed', 'quoteNetwork']) assert.match(failedView(kind).body, /bạn chưa bị trừ điểm/i);
  assert.equal(redeemErrorView({ code: 'INSUFFICIENT_POINTS', message: '', details: { required: 1500, available: 1200 } }, { ...ctx, availableBefore: 1200 }).rows[0].value, '1.500 điểm');
  const insufficient = redeemErrorView({ code: 'INSUFFICIENT_POINTS', message: '', details: { required: 150, available: 120 } }, ctx);
  assert.match(insufficient.body, /66/); assert.deepEqual(insufficient.rows.map(r => r.value), ['150 điểm', '120 điểm', '30 điểm']);
  assert.doesNotMatch(redeemErrorView({ code: 'INSUFFICIENT_POINTS', message: '', details: { required: 150, available: 120 } }, { ...ctx, availableBefore: 120 }).body, /Một giao dịch/);
  // Story 13.11 AC 10: refundHoldPoints row + sentence
  const withHold = redeemErrorView({ code: 'INSUFFICIENT_POINTS', message: '', details: { required: 150, available: 120, refundHoldPoints: 250 } }, ctx);
  assert.deepEqual(withHold.rows.map(r => r.value), ['150 điểm', '120 điểm', '250 điểm', '30 điểm']);
  assert.equal(withHold.rows[2].label, 'Đang giữ chờ hoàn tiền');
  assert.match(withHold.body, /250 Điểm đang giữ chờ hoàn tiền/);
  for (const invalid of [0, -10, "250"]) {
    const invalidView = redeemErrorView({ code: 'INSUFFICIENT_POINTS', message: '', details: { required: 150, available: 120, refundHoldPoints: invalid } }, ctx);
    assert.deepEqual(invalidView.rows, insufficient.rows);
    assert.equal(invalidView.body, insufficient.body);
  }
  const sold = { code: 'SOLD_OUT', message: '', details: { voucherId: voucher.id, regularStockRemaining: 1 } };
  assert.equal(redeemErrorView(sold, ctx).primary.target, 'close'); assert.equal(redeemErrorView(sold, ctx).title, 'Vừa hết suất Flash Sale'); assert.equal(redeemErrorView(sold, { ...ctx, priceSource: 'BASE' }).title, 'Voucher vừa hết hàng');
  assert.equal(redeemErrorView({ ...sold, details: { ...sold.details, regularStockRemaining: 0 } }, ctx).primary.target, 'rewardsCategory');
  const changed = redeemErrorView({ code: 'PRICE_CHANGED', message: '', details: { voucherId: voucher.id, price: { points: 150, basePoints: 250, source: 'FLASH', discountPercent: 40, priceVersion: 2 } } }, ctx);
  assert.equal(changed.rows[0].oldValue, '90 điểm'); assert.equal(changed.rows[0].value, '150 điểm'); assert.deepEqual(changed.primary, { label: 'Đổi với giá 150 điểm', target: 'requote' });
  assert.doesNotMatch(readFileSync(new URL('../lib/rewards/redeem-flow.ts', import.meta.url), 'utf8'), /["']\/rewards/);
});

test('format and animation helpers', () => {
  assert.equal(tweenValue(186, 36, 0, 400), 186); assert.equal(tweenValue(186, 36, 400, 400), 36);
  assert.ok(Number.isInteger(tweenValue(186, 36, 200, 400))); assert.ok(tweenValue(186, 36, 200, 400) < 186);
  assert.ok(tweenValue(36, 186, 200, 400) > 36);
  assert.deepEqual(['FLASH', 'PROMO', 'BASE'].map(confirmPriceLabel), ['Giá Flash Sale', 'Giá ưu đãi', 'Giá đổi']);
  assert.match(flashEndsLine('2026-10-13T08:00:00.000Z', Date.parse('2026-10-13T07:00:00Z')), /15:00\./);
  assert.match(flashEndsLine('2026-10-14T08:00:00.000Z', Date.parse('2026-10-13T07:00:00Z')), /15:00 14\/10/);
  assert.equal(shouldSubmitRequote(150, { price: { points: 150 } }), true);
  assert.equal(shouldSubmitRequote(150, { price: { points: 120 } }), false);
});

test('source guards: keys created for new confirmations, dialog dismissible', () => {
  const hook = readFileSync(new URL('../app/(signed-in)/(app)/rewards/hooks/use-redeem-flow.ts', import.meta.url), 'utf8');
  assert.match(hook, /import \{ randomUuid \}/); assert.equal((hook.match(/randomUuid\(\)/g) ?? []).length, 2);
  const sheet = readFileSync(new URL('../app/(signed-in)/(app)/rewards/components/RedeemSheet.tsx', import.meta.url), 'utf8');
  assert.match(sheet, /dismissible=\{!busy && !polling\}/);
  assert.match(hook, /current === "checking" && !pollExhausted\)\) return;/, 'close is blocked while polling');
});
