import { test } from 'node:test';
import assert from 'node:assert/strict';

const day = 86400000;
const hour = 3600000;
const iso = (time) => new Date(time).toISOString();

// --- Loader (extensionless .ts and `@/` imports used by the mock data modules) ---
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

// Mock rules
const rules = await import('../mocks/data/rewards-rules.ts');
const mock = await import('../mocks/data/rewards.ts');
const schemas = await import('@rescom/schemas');
const now = Date.parse('2026-10-13T05:00:00.000Z');

test('(Story 12.4, AC3) markUsedDecision: expired rejected, used unchanged, unused gets a 24 h undo window', () => {
  const expired = { usedAt: null, undoUntil: null, expiresAt: iso(now - 1) };
  assert.deepEqual(rules.markUsedDecision(expired, now), { ok: false, status: 409, code: 'TICKET_EXPIRED' });
  const used = { usedAt: iso(now - hour), undoUntil: iso(now + 23 * hour), expiresAt: iso(now + day) };
  assert.deepEqual(rules.markUsedDecision(used, now), { ok: true, changed: false });
  const unused = { usedAt: null, undoUntil: null, expiresAt: iso(now + 30 * day) };
  const decision = rules.markUsedDecision(unused, now);
  assert.equal(decision.ok && decision.changed, true);
  assert.equal(decision.usedAt, iso(now));
  assert.equal(Date.parse(decision.undoUntil), Date.parse(decision.usedAt) + day);
});

test('(Story 12.4, AC3) undoUseDecision: inside window changes, at undoUntil closes, not used is unchanged', () => {
  const used = { usedAt: iso(now - hour), undoUntil: iso(now + 1000), expiresAt: iso(now + 30 * day) };
  assert.deepEqual(rules.undoUseDecision(used, now), { ok: true, changed: true });
  assert.deepEqual(rules.undoUseDecision(used, now + 1000), { ok: false, status: 409, code: 'UNDO_WINDOW_CLOSED' });
  assert.deepEqual(rules.undoUseDecision({ ...used, usedAt: null, undoUntil: null }, now), { ok: true, changed: false });
});

test('(Story 12.4, AC4) codeIssueDecision: expired, already open, ok (REJECTED/REPLACED may report again)', () => {
  const ticket = { usedAt: null, undoUntil: null, expiresAt: iso(now + 30 * day), openIssue: null };
  assert.equal(rules.codeIssueDecision({ ...ticket, expiresAt: iso(now) }, now).code, 'TICKET_EXPIRED');
  const open = rules.codeIssueDecision({ ...ticket, openIssue: { status: 'OPEN' } }, now);
  assert.deepEqual([open.status, open.code], [409, 'CODE_ISSUE_ALREADY_OPEN']);
  assert.equal(rules.codeIssueDecision(ticket, now).ok, true);
  assert.equal(rules.codeIssueDecision({ ...ticket, openIssue: { status: 'REJECTED' } }, now).ok, true);
});

test('(Story 12.4, AC4) a REFUNDED ticket rejects mark used, undo and a new report with 409 TICKET_REFUNDED', () => {
  const refunded = { usedAt: iso(now - hour), undoUntil: iso(now + hour), expiresAt: iso(now + 30 * day), openIssue: { status: 'REFUNDED' } };
  const want = { ok: false, status: 409, code: 'TICKET_REFUNDED' };
  assert.deepEqual(rules.markUsedDecision({ ...refunded, usedAt: null, undoUntil: null }, now), want);
  assert.deepEqual(rules.undoUseDecision(refunded, now), want);
  assert.deepEqual(rules.codeIssueDecision(refunded, now), want);
  assert.ok(schemas.VOUCHER_TICKET_ERROR_CODES.includes('TICKET_REFUNDED'));
});

test('(Story 12.4, AC5) historyMonthSummary: Figma-like 375 / 3, ignores last month, Vietnam month boundary', () => {
  const row = (kind, points, createdAt) => ({ kind, points, createdAt });
  const rows = [
    row('SUCCEEDED', -100, iso(now - 5 * day)), row('SUCCEEDED', -125, iso(now - day)), row('SUCCEEDED', -150, iso(now - hour)),
    row('FAILED', 0, iso(now - 2 * hour)), row('SUCCEEDED', -999, iso(now - 20 * day)),
  ];
  assert.deepEqual(rules.historyMonthSummary(rows, now), { month: '2026-10', pointsSpent: 375, voucherCount: 3 });
  const refunded = [...rows, row('REFUNDED', 200, iso(now - 3 * day))];
  assert.deepEqual(rules.historyMonthSummary(refunded, now), { month: '2026-10', pointsSpent: 175, voucherCount: 2 });
  // A refund of last month's redemption leaves a negative month.
  assert.deepEqual(rules.historyMonthSummary([row('REFUNDED', 200, iso(now))], now), { month: '2026-10', pointsSpent: -200, voucherCount: -1 });
  // UTC 17:30 on Sep 30 is already Oct 1 in Vietnam (UTC+7).
  const boundary = Date.parse('2026-09-30T17:30:00.000Z');
  assert.equal(rules.historyMonthSummary([row('SUCCEEDED', -100, iso(boundary))], boundary + day).voucherCount, 1);
  assert.equal(rules.historyMonthSummary([row('SUCCEEDED', -100, iso(boundary))], boundary - 2 * day).voucherCount, 0);
});

// Seed
test('(Story 12.4) the demo account under a generated session id gets its own copy of the seed', () => {
  const demo = { id: 'a1b2c3d4-0000-4000-8000-000000000abc', email: 'minh.le@fpt.edu.vn' };
  mock.claimDemoRewards(demo);
  assert.equal(mock.ticketsOf(demo.id).total, 5);
  mock.rewardsState.update((draft) => { draft.users[demo.id].tickets = []; });
  mock.claimDemoRewards(demo);
  assert.equal(mock.ticketsOf(demo.id).total, 0, 'an existing state is never re-seeded');
  assert.equal(mock.ticketsOf('user-active-002').total, 5, 'the template is untouched');
  mock.claimDemoRewards({ id: 'someone-else', email: 'other@fpt.edu.vn' });
  assert.equal(mock.rewardsState.get().users['someone-else'], undefined);
});

test('(Story 12.4) seeded demo tickets parse with category; list recomputes status, sorts by expiry, drops refunded', () => {
  const user = 'user-active-002';
  const seeded = mock.rewardsState.get().users[user];
  seeded.tickets.forEach((ticket) => {
    schemas.voucherTicketSchema.parse(ticket);
    assert.ok(ticket.category, ticket.reference);
  });
  const list = schemas.voucherTicketListSchema.parse(mock.ticketsOf(user));
  assert.equal(list.total, 5);
  const expiries = list.items.map((item) => Date.parse(item.expiresAt));
  assert.deepEqual(expiries, [...expiries].sort((a, b) => a - b));
  // Status comes from the clock, not from storage.
  const farFuture = mock.ticketsOf(user, Date.now() + 365 * day);
  assert.ok(farFuture.items.filter((item) => item.status !== 'USED').every((item) => item.status === 'EXPIRED'));

  const target = seeded.tickets[0];
  mock.rewardsState.update((draft) => { draft.users[user].tickets[0].openIssue = { id: draft.users[user].issues[0].id, status: 'REFUNDED' }; });
  assert.equal(mock.ticketsOf(user).items.some((item) => item.id === target.id), false);
  assert.equal(mock.ticketsOf(user).total, 4);
  const detail = mock.ticketOf(user, target.id);
  assert.equal(detail.ticket.openIssue.status, 'REFUNDED');
  schemas.voucherTicketResponseSchema.parse(detail);
  assert.equal(mock.ticketOf(user, '00000000-0000-4000-8000-000000000999'), null);
});

// Lib
const lib = await import('../lib/rewards/my-vouchers.ts');
const { ApiError } = await import('../lib/api/api-error.ts');
const { encode } = await import('uqr');
const { readFileSync } = await import('node:fs');

const ticket = (overrides = {}) => ({
  id: 't', status: 'UNUSED', redeemedAt: iso(now - day), expiresAt: iso(now + 30 * day), usedAt: null, undoUntil: null, openIssue: null, ...overrides,
});
const used = (overrides = {}) => ticket({ status: 'USED', usedAt: iso(now - hour), undoUntil: iso(now + 23 * hour), ...overrides });

test('(Story 12.4, AC1) ticketsByTab groups by tab and sorts: unused expiry asc, used usedAt desc, expired expiry desc', () => {
  const items = [
    ticket({ id: 'u3', expiresAt: iso(now + 30 * day) }), ticket({ id: 'u1', status: 'EXPIRING', expiresAt: iso(now + 3 * day) }), ticket({ id: 'u2', expiresAt: iso(now + 10 * day) }),
    used({ id: 'd1', usedAt: iso(now - 5 * day) }), used({ id: 'd2', usedAt: iso(now - hour) }), used({ id: 'd3', usedAt: iso(now - day) }),
    ticket({ id: 'e1', status: 'EXPIRED', expiresAt: iso(now - 20 * day) }), ticket({ id: 'e2', status: 'EXPIRED', expiresAt: iso(now - day) }),
  ];
  const tabs = lib.ticketsByTab(items);
  assert.deepEqual(tabs.unused.map((item) => item.id), ['u1', 'u2', 'u3']);
  assert.deepEqual(tabs.used.map((item) => item.id), ['d2', 'd3', 'd1']);
  assert.deepEqual(tabs.expired.map((item) => item.id), ['e2', 'e1']);
  assert.equal(lib.unusedCount(items), 3);
  assert.equal(lib.unusedCount([]), 0);
});

test('(Story 12.4) parseVoucherTab defaults to unused', () => {
  assert.equal(lib.parseVoucherTab(null), 'unused');
  assert.equal(lib.parseVoucherTab('nope'), 'unused');
  assert.equal(lib.parseVoucherTab('used'), 'used');
  assert.equal(lib.parseVoucherTab('expired'), 'expired');
});

test('(Story 12.4) ticketTagView: days left rounds up, minimum 1; other statuses are words', () => {
  assert.deepEqual(lib.ticketTagView(ticket({ status: 'EXPIRING', expiresAt: iso(now + 7 * day - hour) }), now), { tone: 'danger', label: 'Còn 7 ngày' });
  assert.deepEqual(lib.ticketTagView(ticket({ status: 'EXPIRING', expiresAt: iso(now + 2 * hour) }), now), { tone: 'danger', label: 'Còn 1 ngày' });
  assert.deepEqual(lib.ticketTagView(ticket(), now), { tone: 'green', label: 'Chưa dùng' });
  assert.deepEqual(lib.ticketTagView(used(), now), { tone: 'neutral', label: 'Đã dùng' });
  assert.deepEqual(lib.ticketTagView(ticket({ status: 'EXPIRED' }), now), { tone: 'neutral', label: 'Hết hạn' });
});

test('(Story 12.4) ticketMetaLine uses the Vietnam calendar day (UTC 17:00 is already tomorrow)', () => {
  const expiresAt = '2026-12-31T16:00:00.000Z';
  // Redeemed 2026-10-12 17:30 UTC = 13/10 00:30 in Vietnam; "now" 13/10 05:00 UTC is 13/10 12:00 there: same day.
  const redeemedAt = '2026-10-12T17:30:00.000Z';
  assert.equal(lib.ticketMetaLine(ticket({ redeemedAt, expiresAt }), now), 'HSD 31/12/2026 · đổi hôm nay');
  // Redeemed 2026-10-12 16:30 UTC = 12/10 23:30 in Vietnam: yesterday, although the UTC date of "now" is the 13th.
  assert.equal(lib.ticketMetaLine(ticket({ redeemedAt: '2026-10-12T16:30:00.000Z', expiresAt }), now), 'HSD 31/12/2026 · đổi ngày 12/10');
  assert.equal(lib.ticketMetaLine(used({ usedAt: '2026-10-08T11:40:00.000Z' }), now), 'Đã dùng 08/10 18:40');
  assert.equal(lib.ticketMetaLine(ticket({ status: 'EXPIRED', expiresAt: '2026-09-30T17:00:00.000Z' }), now), 'Hết hạn 01/10/2026');
});

test('(Story 12.4) expiringNotice and myVouchersSubtitle count EXPIRING', () => {
  const one = [ticket({ status: 'EXPIRING' }), ticket(), ticket(), used()];
  assert.equal(lib.expiringNotice(one), '1 voucher hết hạn trong 7 ngày. Rescom sẽ nhắc lại trước 1 ngày.');
  assert.equal(lib.myVouchersSubtitle(one), '3 voucher chưa dùng · 1 voucher hết hạn trong 7 ngày');
  assert.equal(lib.expiringNotice([ticket()]), null);
  assert.equal(lib.myVouchersSubtitle([ticket()]), '1 voucher chưa dùng');
});

test('(Story 12.4, AC3) canUndo closes exactly at undoUntil; undoLine is Vietnam time', () => {
  const undoUntil = iso(now + hour);
  assert.equal(lib.canUndo(used({ undoUntil }), Date.parse(undoUntil) - 1), true);
  assert.equal(lib.canUndo(used({ undoUntil }), Date.parse(undoUntil)), false);
  assert.equal(lib.canUndo(ticket(), now), false);
  assert.equal(lib.undoLine(used({ undoUntil: '2026-10-14T17:30:00.000Z' })), 'Bạn có thể hoàn tác đến 00:30 15/10.');
});

test('(Story 12.4, AC4) canReportIssue is false for EXPIRED, OPEN and REFUNDED reports only', () => {
  assert.equal(lib.canReportIssue(ticket()), true);
  assert.equal(lib.canReportIssue(used()), true);
  assert.equal(lib.canReportIssue(ticket({ status: 'EXPIRED' })), false);
  assert.equal(lib.canReportIssue(ticket({ openIssue: { id: 'i', status: 'OPEN' } })), false);
  assert.equal(lib.canReportIssue(ticket({ openIssue: { id: 'i', status: 'REFUNDED' } })), false);
  assert.equal(lib.canReportIssue(ticket({ openIssue: { id: 'i', status: 'REJECTED' } })), true);
  assert.equal(lib.canReportIssue(ticket({ openIssue: { id: 'i', status: 'REPLACED' } })), true);
});

test('(Story 12.4, AC4) every issue status and reason has its copy; action errors map by code', () => {
  for (const status of ['OPEN', 'REPLACED', 'REFUNDED', 'REJECTED']) {
    const view = lib.codeIssueStatusView(status);
    assert.ok(view.title && view.body && view.tone, status);
  }
  assert.equal(lib.codeIssueStatusView('OPEN').title, 'Đang xử lý báo lỗi');
  assert.deepEqual(lib.CODE_ISSUE_REASONS, ['CODE_INVALID', 'CODE_ALREADY_USED', 'STORE_REFUSED', 'OTHER']);
  assert.equal(lib.CODE_ISSUE_REASON_LABELS.OTHER, 'Lý do khác');
  const http = (code) => new ApiError({ kind: 'http', status: 409, code, message: code });
  assert.equal(lib.ticketActionErrorMessage(http('TICKET_EXPIRED')), 'Voucher đã hết hạn nên không đánh dấu hay báo lỗi được nữa.');
  assert.equal(lib.ticketActionErrorMessage(http('UNDO_WINDOW_CLOSED')), 'Đã quá 24 giờ nên không hoàn tác được nữa.');
  assert.equal(lib.ticketActionErrorMessage(http('CODE_ISSUE_ALREADY_OPEN')), 'Mã này đang được xử lý báo lỗi. Admin sẽ phản hồi trong 1 ngày làm việc.');
  assert.equal(lib.ticketActionErrorMessage(http('TICKET_REFUNDED')), 'Voucher đã được hoàn điểm nên không dùng được nữa.');
  assert.equal(lib.ticketActionErrorMessage(new ApiError({ kind: 'http', status: 404, code: 'TICKET_NOT_FOUND', message: 'x' })), 'Không tìm thấy voucher này nữa. Quay lại Voucher của tôi nhé.');
  assert.equal(lib.ticketActionErrorMessage(http('SOMETHING_ELSE')), 'Chưa lưu được. Thử lại nhé.');
  assert.equal(lib.ticketActionErrorMessage(new Error('boom')), 'Chưa lưu được. Thử lại nhé.');
});

test('(Story 12.4, AC5) historyRowView: SUCCEEDED, FAILED (Flash SOLD_OUT) and REFUNDED rows', () => {
  const entry = (overrides) => ({
    id: 'h', reference: 'RDM-2610-8F2K', kind: 'SUCCEEDED', voucherTitle: 'Voucher', brand: { id: 'highlands', name: 'Highlands Coffee' }, valueVnd: 50000,
    isFlash: true, points: -150, failureCode: null, journalId: 'j', note: null, createdAt: '2026-10-13T05:05:00.000Z', ...overrides,
  });
  const ok = lib.historyRowView(entry());
  assert.equal(ok.points, '−150');
  assert.equal(ok.points.charCodeAt(0), 0x2212);
  assert.deepEqual([ok.icon, ok.status, ok.statusTone, ok.pointsTone], ['check', 'Thành công', 'green', 'default']);
  assert.equal(ok.title, 'Highlands Coffee · 50.000đ');
  assert.equal(ok.desktopTitle, 'Highlands Coffee · 50.000đ (Flash)');
  assert.equal(ok.subline, 'Flash Sale · 13/10 12:05 · RDM-2610-8F2K');
  assert.equal(lib.historyRowView(entry({ isFlash: false })).desktopTitle, 'Highlands Coffee · 50.000đ');

  const failed = lib.historyRowView(entry({ kind: 'FAILED', points: 0, failureCode: 'SOLD_OUT', journalId: null, reference: 'RDM-2610-0P9C' }));
  assert.deepEqual([failed.icon, failed.points, failed.status, failed.desktopStatus, failed.statusTone], ['x', '0', 'Thất bại · không trừ', 'Thất bại · hết suất', 'danger']);
  assert.equal(failed.subline, 'Flash Sale · 13/10 12:05 · hết suất');
  // The seed note repeats "Flash Sale · "; the line must not.
  assert.equal(lib.historyRowView(entry({ kind: 'FAILED', points: 0, failureCode: 'SOLD_OUT', journalId: null, note: 'Flash Sale · hết suất' })).subline, 'Flash Sale · 13/10 12:05 · hết suất');
  assert.equal(lib.historyRowView(entry({ kind: 'FAILED', points: 0, failureCode: 'SOLD_OUT', journalId: null, isFlash: false })).subline, '13/10 12:05 · hết hàng');
  assert.equal(lib.historyRowView(entry({ kind: 'FAILED', points: 0, failureCode: 'PRICE_CHANGED', journalId: null, isFlash: false })).subline, '13/10 12:05 · giá đã đổi');
  // An empty note (or only the Flash prefix) falls back to the short reason.
  assert.equal(lib.historyRowView(entry({ kind: 'FAILED', points: 0, failureCode: 'SOLD_OUT', journalId: null, note: 'Flash Sale · ' })).subline, 'Flash Sale · 13/10 12:05 · hết suất');
  assert.equal(lib.historyRowView(entry({ kind: 'FAILED', points: 0, failureCode: 'PRICE_CHANGED', journalId: null, isFlash: false, note: '' })).subline, '13/10 12:05 · giá đã đổi');

  const refund = lib.historyRowView(entry({ kind: 'REFUNDED', points: 200, reference: 'RFD-2610-7HC2', isFlash: false, note: 'mã lỗi, Admin duyệt' }));
  assert.deepEqual([refund.icon, refund.points, refund.status, refund.statusTone, refund.pointsTone], ['refund', '+200', 'Đã hoàn điểm', 'blue', 'blue']);
  assert.equal(refund.desktopStatus, 'Đã hoàn · mã lỗi');
  assert.equal(refund.subline, '13/10 12:05 · mã lỗi, Admin duyệt');
  assert.equal(lib.historyRowView(entry({ kind: 'REFUNDED', points: 200, reference: 'RFD-2610-7HC2', note: null })).subline, '13/10 12:05 · RFD-2610-7HC2');
});

test('(Story 12.4, AC5) monthSummaryLine: Figma 375 / 3 and the empty sentence', () => {
  assert.deepEqual(lib.monthSummaryLine({ month: '2026-10', pointsSpent: 375, voucherCount: 3 }), { month: 'Tháng 10/2026', line: 'Đã dùng 375 điểm cho 3 voucher', short: 'Tháng 10: 375 điểm · 3 voucher' });
  assert.equal(lib.monthSummaryLine({ month: '2026-10', pointsSpent: 0, voucherCount: 0 }).line, 'Tháng này bạn chưa đổi voucher nào.');
  assert.equal(lib.monthSummaryLine({ month: '2026-10', pointsSpent: -200, voucherCount: -1 }).line, 'Tháng này bạn chưa đổi voucher nào.');
  assert.equal(lib.monthSummaryLine({ month: '2026-10', pointsSpent: 1500, voucherCount: 1 }).line, 'Đã dùng 1.500 điểm cho 1 voucher');
  // A refund bigger than this month's spend never prints a negative amount.
  assert.equal(lib.monthSummaryLine({ month: '2026-10', pointsSpent: -100, voucherCount: 1 }).line, 'Đã dùng 0 điểm cho 1 voucher');
});

test('(Story 12.4, AC2) qrModules renders the encoder matrix as one path; no route literal in the lib', () => {
  const text = 'HLRC-7K2M-9QXA';
  const { size, path } = lib.qrModules(text);
  const expected = encode(text, { ecc: 'M', border: 4 });
  assert.equal(size, expected.size);
  // 4-module quiet zone: no dark module in the outer 4 rows/columns.
  assert.equal(size, encode(text, { ecc: 'M', border: 0 }).size + 2 * lib.QR_QUIET_ZONE);
  for (const [, x, y] of path.matchAll(/M(\d+) (\d+)/g)) for (const v of [Number(x), Number(y)]) assert.ok(v >= 4 && v < size - 4);
  assert.equal(path.split('h1v1h-1z').length - 1, expected.data.flat().filter(Boolean).length);
  assert.match(path, /^M\d+ \d+h1v1h-1z/);
  assert.equal(readFileSync(new URL('../lib/rewards/my-vouchers.ts', import.meta.url), 'utf8').includes('"/rewards'), false);
});
