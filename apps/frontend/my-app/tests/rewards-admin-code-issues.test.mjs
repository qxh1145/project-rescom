import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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
const { getResponse } = await import('msw');
const rules = await import('../mocks/data/rewards-rules.ts');
const mock = await import('../mocks/data/rewards.ts');
const economy = await import('../mocks/data/economy.ts');
const { historyKindOf } = await import('../lib/wallet/wallet-history.ts');
const schemas = await import('@rescom/schemas');
const { rewardsAdminHandlers } = await import('../mocks/handlers/rewards-admin.ts');
const { rewardHandlers } = await import('../mocks/handlers/rewards.ts');
const { resetStore, setCurrentUserId, setMockStorage } = await import('../mocks/legacy/store.ts');
const { mockRepository } = await import('../mocks/legacy/repository.ts');
mockRepository.setLatency(0);
const now = Date.now(), iso = n => new Date(n).toISOString();
const initial = { catalog: structuredClone(mock.rewardsCatalog.get()), users: structuredClone(mock.rewardsState.get()), wallets: structuredClone(economy.wallets.get()), transactions: structuredClone(economy.transactions.get()) };
const storage = new Map();
const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
setMockStorage(localStorage);
globalThis.window = { location: { search: '?msw=default' }, localStorage };
beforeEach(() => {
  mock.rewardsCatalog.set(structuredClone(initial.catalog)); mock.rewardsState.set(structuredClone(initial.users));
  economy.wallets.set(structuredClone(initial.wallets)); economy.transactions.set(structuredClone(initial.transactions));
  storage.clear(); resetStore(); setCurrentUserId('user-admin-004'); window.location.search = '?msw=default';
});
async function call(method, route, body, { csrf = true, user = false } = {}) {
  const response = await getResponse(user ? rewardHandlers : rewardsAdminHandlers, new Request(`http://localhost/api/${user ? 'rewards' : 'admin/rewards'}/${route}`, {
    method, headers: { ...(csrf ? { 'X-CSRF-Token': 'test' } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { baseUrl: 'http://localhost' });
  assert.ok(response, `${method} ${route} must have handler`);
  return { status: response.status, body: await response.json() };
}
const list = (status = 'OPEN', limit = 50, offset = 0) => call('GET', `code-issues?status=${status}&limit=${limit}&offset=${offset}`);
const detail = id => call('GET', `code-issues/${id}`);
const resolve = (id, outcome, note) => call('POST', `code-issues/${id}/resolve`, { outcome, ...(note === undefined ? {} : { note }) });
const error = (response, status, code) => assert.deepEqual([response.status, response.body.error.code], [status, code], JSON.stringify(response.body));
const issue = (brand, status = 'OPEN') => mock.adminCodeIssuesOf({ status: 'ALL', limit: 50, offset: 0 }, now).items.find(row => row.voucher.brand.name.includes(brand) && row.status === status);
const owner = id => Object.entries(mock.rewardsState.get().users).find(([, user]) => user.issues.some(report => report.id === id));
function assertSecret(response) {
  const payload = JSON.stringify(response.body);
  const secrets = new Set([...Object.values(mock.rewardsState.get().users).flatMap(user => user.tickets.map(ticket => ticket.code)), ...Object.values(mock.rewardsCatalog.get().codePools).flat()]);
  for (const secret of secrets) if (secret?.length >= 4) assert.equal(payload.includes(secret), false, `admin leaked code ${secret}`);
}

test('blocked reason priority, expiry boundary and resolved report', () => {
  const facts = { status: 'OPEN', isSharedCode: false, expiresAt: iso(now + 1), stockRemaining: 1, codesAvailable: 1 };
  assert.equal(rules.replaceBlockedReason({ ...facts, isSharedCode: true, expiresAt: iso(now - 1), stockRemaining: 0 }, now), 'SHARED_CODE');
  assert.equal(rules.replaceBlockedReason({ ...facts, expiresAt: iso(now), stockRemaining: 0 }, now), 'TICKET_EXPIRED');
  assert.equal(rules.replaceBlockedReason({ ...facts, stockRemaining: 0, codesAvailable: 0 }, now), 'NO_STOCK');
  assert.equal(rules.replaceBlockedReason({ ...facts, codesAvailable: 0 }, now), 'NO_CODE');
  assert.equal(rules.replaceBlockedReason(facts, now), null);
  assert.equal(rules.replaceBlockedReason({ ...facts, expiresAt: iso(now) }, now - 1), null);
  assert.equal(rules.replaceBlockedReason({ ...facts, status: 'REPLACED', isSharedCode: true }, now), null);
});

test('resolution decision matrix and conflict priority', () => {
  const ticket = { expiresAt: iso(now + 1000), refunded: false };
  const voucher = { isSharedCode: false, stockRemaining: 1, codesAvailable: 1 };
  for (const outcome of ['REPLACE', 'REFUND', 'REJECT']) {
    assert.equal(rules.resolveCodeIssueDecision({ status: 'OPEN' }, ticket, voucher, outcome, now).ok, true);
    for (const [status, match] of [['REPLACED', 'REPLACE'], ['REFUNDED', 'REFUND'], ['REJECTED', 'REJECT']]) {
      const result = rules.resolveCodeIssueDecision({ status }, ticket, voucher, outcome, now);
      if (outcome === match) assert.equal(result.ok && result.replay, true);
      else assert.deepEqual([result.status, result.code], [409, 'CODE_ISSUE_ALREADY_RESOLVED']);
    }
  }
  assert.equal(rules.resolveCodeIssueDecision({ status: 'OPEN' }, { ...ticket, expiresAt: iso(now) }, voucher, 'REFUND', now).ok, true);
  assert.equal(rules.resolveCodeIssueDecision({ status: 'OPEN' }, { ...ticket, refunded: true }, voucher, 'REFUND', now).code, 'TICKET_REFUNDED');
  assert.equal(rules.resolveCodeIssueDecision({ status: 'OPEN' }, ticket, { ...voucher, isSharedCode: true, stockRemaining: 0 }, 'REPLACE', now).code, 'REPLACEMENT_NOT_SUPPORTED');
  assert.equal(rules.resolveCodeIssueDecision({ status: 'OPEN' }, { ...ticket, expiresAt: iso(now) }, { ...voucher, stockRemaining: 0 }, 'REPLACE', now).code, 'TICKET_EXPIRED');
  assert.equal(rules.resolveCodeIssueDecision({ status: 'OPEN' }, ticket, { ...voucher, codesAvailable: 0 }, 'REPLACE', now).code, 'NO_REPLACEMENT_AVAILABLE');
});

test('seed list counts, oldest-first pagination, schemas, secret codes', async () => {
  const all = await list('ALL'), open = await list(), resolved = await list('RESOLVED');
  for (const response of [all, open, resolved]) {
    assert.equal(response.status, 200); schemas.adminCodeIssueListSchema.parse(response.body.data);
    assert.equal(response.body.data.summary.open, 6); assertSecret(response);
    assert.deepEqual(response.body.data.items.map(r => r.createdAt), response.body.data.items.map(r => r.createdAt).sort());
    for (const row of response.body.data.items) {
      assert.equal(row.userLabel, `#${owner(row.id)[0].slice(0, 4).toUpperCase()}`);
      const one = { body: { data: mock.adminCodeIssueOf(row.id).result } };
      schemas.adminCodeIssueSchema.parse(one.body.data); assertSecret(one);
    }
  }
  assert.deepEqual([open.body.data.total, resolved.body.data.total, all.body.data.total], [6, 32, 38]);
  assert.equal(open.body.data.summary.oldestOpenAt, open.body.data.items[0].createdAt);
  assert.equal(open.body.data.items[0].voucher.brand.name, 'Phúc Long');
  assert.deepEqual(open.body.data.items.map(r => r.replaceBlockedReason), ['TICKET_EXPIRED', null, null, null, 'NO_CODE', 'SHARED_CODE']);
  assert.deepEqual(open.body.data.items.map(r => r.canReplace), [false, true, true, true, false, false]);
  assert.equal(all.body.data.items.filter(r => r.id === '00000000-0000-4000-8000-000000000493').length, 1);
  const page = await list('RESOLVED', 10, 10);
  assert.equal(page.body.data.items.length, 10); assert.equal(page.body.data.hasMore, true);
  for (const row of [open.body.data.items[0], resolved.body.data.items[0], resolved.body.data.items.at(-1)]) {
    const one = await detail(row.id); schemas.adminCodeIssueSchema.parse(one.body.data); assertSecret(one);
  }
});

test('guards, validation, unknown report, and all 409 conflicts', async () => {
  setCurrentUserId(null); assert.equal((await list()).status, 401);
  setCurrentUserId('user-new-001'); error(await list(), 403, 'FORBIDDEN_RESOURCE');
  setCurrentUserId('user-admin-004');
  error(await call('GET', 'code-issues?status=BOGUS'), 400, 'VALIDATION_ERROR');
  error(await call('GET', 'code-issues?limit=0'), 400, 'VALIDATION_ERROR');
  error(await detail('not-a-uuid'), 400, 'VALIDATION_ERROR');
  const unknown = '00000000-0000-4000-8000-000000009999';
  error(await detail(unknown), 404, 'CODE_ISSUE_NOT_FOUND');
  const id = issue('Highlands').id;
  error(await call('POST', `code-issues/${id}/resolve`, { outcome: 'REJECT' }, { csrf: false }), 403, 'AUTH_INVALID_CSRF_TOKEN');
  error(await call('POST', `code-issues/${id}/resolve`, { outcome: 'WRONG' }), 400, 'VALIDATION_ERROR');
  error(await resolve(id, 'REJECT'), 400, 'VALIDATION_ERROR');
  error(await call('POST', 'code-issues/not-a-uuid/resolve', { outcome: 'REFUND' }), 400, 'VALIDATION_ERROR');
  error(await resolve(unknown, 'REFUND'), 404, 'CODE_ISSUE_NOT_FOUND');
  error(await resolve(issue('Gong Cha').id, 'REPLACE'), 409, 'REPLACEMENT_NOT_SUPPORTED');
  error(await resolve(issue('Phúc Long').id, 'REPLACE'), 409, 'TICKET_EXPIRED');
  error(await resolve(issue('The Coffee House').id, 'REPLACE'), 409, 'NO_REPLACEMENT_AVAILABLE');
  const voucherId = issue('Highlands').voucher.id;
  mock.rewardsCatalog.update(d => { d.vouchers.find(v => v.id === voucherId).stockRemaining = 0; });
  error(await resolve(id, 'REPLACE'), 409, 'NO_REPLACEMENT_AVAILABLE');
  assert.equal((await resolve(id, 'REJECT', 'Không hợp lệ')).status, 200);
  error(await resolve(id, 'REFUND'), 409, 'CODE_ISSUE_ALREADY_RESOLVED');
});

test('forced scenarios leave report, stock, and codes unchanged', async () => {
  const id = issue('Highlands').id;
  const before = structuredClone({ users: mock.rewardsState.get(), catalog: mock.rewardsCatalog.get() });
  for (const [scenario, code] of [['rewards-resolve-already-resolved', 'CODE_ISSUE_ALREADY_RESOLVED'], ['rewards-resolve-no-replacement', 'NO_REPLACEMENT_AVAILABLE'], ['rewards-resolve-not-supported', 'REPLACEMENT_NOT_SUPPORTED'], ['rewards-resolve-ticket-expired', 'TICKET_EXPIRED']]) {
    window.location.search = `?msw=${scenario}`;
    error(await resolve(id, 'REPLACE'), 409, code);
    assert.deepEqual(mock.rewardsState.get(), before.users);
    assert.deepEqual(mock.rewardsCatalog.get(), before.catalog);
  }
});

test('replacement consumes one code and resets used ticket; replay consumes nothing', async () => {
  const row = issue('Highlands'); const [userId, user] = owner(row.id);
  const ticket = user.tickets.find(t => t.redemptionId === row.redemptionId);
  const beforeCode = ticket.code, nextCode = mock.rewardsCatalog.get().codePools[row.voucher.id][0];
  const originalStock = mock.rewardsCatalog.get().vouchers.find(v => v.id === row.voucher.id).stockRemaining;
  const done = await resolve(row.id, 'REPLACE');
  assert.equal(done.status, 200); schemas.adminCodeIssueSchema.parse(done.body.data); assertSecret(done);
  const replaced = mock.ticketOf(userId, ticket.id).ticket;
  assert.equal(replaced.code, nextCode); assert.notEqual(replaced.code, beforeCode);
  assert.equal(replaced.usedAt, null); assert.equal(replaced.openIssue.status, 'REPLACED');
  assert.equal(mock.rewardsCatalog.get().vouchers.find(v => v.id === row.voucher.id).stockRemaining, originalStock - 1);
  assert.equal(mock.rewardsCatalog.get().codePools[row.voucher.id].includes(nextCode), false);
  assert.deepEqual((await resolve(row.id, 'REPLACE')).body, done.body);
});

test('refund credits wallet once, adds RFD history, reverses ledger, hides ticket', async () => {
  const userId = '00000000-0000-4000-8000-00000000d001';
  const user = { id: userId, email: 'minh.le@fpt.edu.vn', name: 'Bạn', role: 'USER', profileComplete: true };
  economy.walletOf(user);
  const ticket = mock.rewardsState.get().users[userId].tickets.find(t => !t.openIssue && Date.parse(t.expiresAt) > Date.now());
  assert.ok(ticket);
  const balance = economy.wallets.get()[userId].available;
  const before = mock.historyOf(userId, { limit: 50, offset: 0 }).monthSummary;
  const report = mock.reportCodeIssue(userId, ticket.id, { reason: 'CODE_INVALID' });
  assert.equal(report.ok, true);
  const done = await resolve(report.result.id, 'REFUND');
  assert.equal(done.status, 200); assertSecret(done);
  assert.match(done.body.data.resolution.refundReference, /^RFD-/);
  assert.equal(economy.wallets.get()[userId].available, balance + ticket.pointsSpent);
  assert.equal(mock.ticketsOf(userId).items.some(t => t.id === ticket.id), false);
  const history = schemas.redemptionHistoryListSchema.parse(mock.historyOf(userId, { limit: 50, offset: 0 }));
  assert.equal(history.items[0].kind, 'REFUNDED');
  assert.equal(history.items[0].reference, done.body.data.resolution.refundReference);
  assert.equal(history.monthSummary.pointsSpent, before.pointsSpent - ticket.pointsSpent);
  const refund = economy.transactions.get()[userId].find(t => t.kind === 'VOUCHER_REFUND' && t.codeIssueReportId === report.result.id);
  assert.ok(refund);
  const ledger = economy.ledgerItemsOf(user, 50, 0).find(item => item.idempotencyKey === `redemption-refund:${report.result.id}`);
  assert.ok(ledger);
  assert.equal(ledger.reversesJournalId, ticket.redemptionId);
  assert.equal(historyKindOf(ledger.idempotencyKey, ledger.reversesJournalId), 'REVERSAL');
  assert.deepEqual((await resolve(report.result.id, 'REFUND')).body, done.body);
  assert.equal(economy.wallets.get()[userId].available, balance + ticket.pointsSpent);
  assert.equal(mock.rewardsState.get().users['user-active-002'].issues.find(i => i.id === report.result.id), undefined);
});

test('reject stores note, preserves ticket and code, allows new report', async () => {
  const row = issue('Lotteria'), [userId, user] = owner(row.id);
  const ticket = user.tickets.find(t => t.redemptionId === row.redemptionId);
  const before = structuredClone(ticket), catalog = structuredClone(mock.rewardsCatalog.get());
  const done = await resolve(row.id, 'REJECT', '  Đã xác minh  ');
  assert.equal(done.status, 200); assert.equal(done.body.data.resolutionNote, 'Đã xác minh'); assertSecret(done);
  assert.deepEqual(mock.rewardsCatalog.get(), catalog);
  assert.deepEqual(mock.rewardsState.get().users[userId].tickets.find(t => t.id === ticket.id), { ...before, openIssue: { id: row.id, status: 'REJECTED' } });
  assert.equal(mock.reportCodeIssue(userId, ticket.id, { reason: 'OTHER' }).ok, true);
  assert.deepEqual((await resolve(row.id, 'REJECT', 'Another note')).body, done.body);
});

test('demo report stays equal across template and clone; user payload stays public', async () => {
  const demo = mock.rewardsState.get().users['user-active-002'].issues[0];
  const first = await resolve(demo.id, 'REFUND');
  assert.equal(first.status, 200); assert.deepEqual((await resolve(demo.id, 'REFUND')).body, first.body);
  assert.deepEqual(mock.rewardsState.get().users['user-active-002'], mock.rewardsState.get().users['00000000-0000-4000-8000-00000000d001']);
  setCurrentUserId('user-active-002');
  const ticket = mock.rewardsState.get().users['00000000-0000-4000-8000-00000000d001'].tickets.find(t => !t.openIssue && Date.parse(t.expiresAt) > Date.now());
  assert.ok(ticket);
  const response = await call('POST', `my-vouchers/${ticket.id}/issues`, { reason: 'OTHER', note: 'Báo lỗi' }, { user: true });
  assert.equal(response.status, 201);
  const parsed = schemas.codeIssueReportSchema.parse(response.body.data);
  assert.deepEqual(Object.keys(response.body.data).sort(), Object.keys(parsed).sort());
  // An OPEN report cloned into a fresh demo session must resolve identically in both copies.
  const open = mock.rewardsState.get().users['user-active-002'].tickets.find(t => !t.openIssue && t.id !== ticket.id && Date.parse(t.expiresAt) > Date.now());
  const reported = mock.reportCodeIssue('user-active-002', open.id, { reason: 'OTHER', note: 'Báo lỗi' });
  assert.equal(reported.ok, true);
  const cloneId = '00000000-0000-4000-8000-00000000c10e';
  mock.claimDemoRewards({ id: cloneId, email: 'minh.le@fpt.edu.vn' });
  setCurrentUserId('user-admin-004');
  assert.equal((await resolve(reported.result.id, 'REFUND')).status, 200);
  const users = mock.rewardsState.get().users;
  assert.equal(users[cloneId].issues.find(i => i.id === reported.result.id).status, 'REFUNDED');
  assert.deepEqual(users['user-active-002'], users[cloneId]);
});
