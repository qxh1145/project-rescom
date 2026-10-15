import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const v = await import('../lib/admin/rewards-code-issues-view.ts');
const { ApiError } = await import('../lib/api/api-error.ts');
const schema = await import('@rescom/schemas');
const issue = { createdAt: '2026-10-13T09:02:00+07:00', resolvedAt: null, reference: 'RDM-2026-ABCD', userLabel: 'An', pricePoints: 150, voucher: { brand: { name: 'Highlands' } } };
const iso = value => new Date(value).toISOString();

test('working-day due dates ignore host timezone and skip weekends', () => {
 for (const [start, due] of [
  ['2026-10-13T09:02:00+07:00', '2026-10-14T09:02:00+07:00'],
  ['2026-10-16T10:00:00+07:00', '2026-10-19T10:00:00+07:00'],
  ['2026-10-16T18:30:00+07:00', '2026-10-20T08:00:00+07:00'],
  ['2026-10-17T11:00:00+07:00', '2026-10-20T08:00:00+07:00'],
  ['2026-10-19T07:59:00+07:00', '2026-10-20T08:00:00+07:00'],
  ['2026-10-19T17:00:00+07:00', '2026-10-21T08:00:00+07:00'],
 ]) assert.equal(v.slaDueAt(start), iso(due));
 const due = Date.parse(v.slaDueAt(issue.createdAt));
 assert.equal(v.openSlaView(issue, due - 1).overdue, false);
 assert.equal(v.openSlaView(issue, due).overdue, true);
 assert.equal(v.resolvedSlaView({ ...issue, resolvedAt: iso(due) }).late, null);
 assert.match(v.resolvedSlaView({ ...issue, resolvedAt: iso(due + 60000) }).late, /trễ hạn 1 phút/);
});
test('wait units and labels', () => {
 for (const [minutes, text] of [[59, '59 phút'], [60, '1 giờ'], [1439, '23 giờ'], [1440, '1 ngày'], [2340, '1 ngày 15 giờ']]) assert.equal(v.formatWait(minutes * 60000), text);
 for (const [map, values] of [[v.CODE_ISSUE_ADMIN_REASON_LABELS, schema.adminCodeIssueSchema.shape.reason.options], [v.PRICE_SOURCE_LABELS, schema.adminCodeIssueSchema.shape.priceSource.options], [v.TICKET_STATUS_VIEW, schema.adminCodeIssueSchema.shape.ticketStatus.options], [v.REPORT_STATUS_VIEW, schema.adminCodeIssueSchema.shape.status.options], [v.REPLACE_BLOCKED_COPY, schema.adminCodeIssueReplaceBlockedReasonSchema.options]]) assert.deepEqual(Object.keys(map).sort(), [...values].sort());
});
test('note validation and schema-safe bodies', () => {
 for (const [raw, valid] of [['', false], ['   ', false], ['X', true], ['X'.repeat(500), true], ['X'.repeat(501), false]]) assert.equal(v.noteState('REJECT', raw).valid, valid);
 assert.equal(v.noteState('REJECT', 'X'.repeat(501)).overBy, 1);
 assert.equal(v.noteState('REPLACE', '').valid, true);
 assert.deepEqual(v.resolveBody('REFUND', '  '), { outcome: 'REFUND' });
 for (const outcome of ['REJECT', 'REFUND', 'REPLACE']) schema.adminResolveCodeIssueSchema.parse(v.resolveBody(outcome, ' test '));
});
test('resolution errors and success copy', () => {
 for (const code of ['NO_REPLACEMENT_AVAILABLE', 'REPLACEMENT_NOT_SUPPORTED', 'TICKET_EXPIRED', 'CODE_ISSUE_ALREADY_RESOLVED', 'TICKET_REFUNDED', 'CODE_ISSUE_NOT_FOUND']) assert.equal(v.resolveErrorView(new ApiError({ kind: 'http', message: code, code, status: 409 }), issue).code, code);
 assert.equal(v.resolveErrorView(new ApiError({ kind: 'network', message: 'offline' }), issue).code, 'NETWORK_ERROR');
 assert.equal(v.resolveErrorView(new ApiError({ kind: 'http', message: 'server', status: 500 }), issue).code, 'NETWORK_ERROR');
 assert.equal(v.resolveErrorView(new Error('failed'), issue).code, 'UNKNOWN');
 assert.match(v.successToast('REFUND', issue).title, /150 điểm/);
});
test('pagination, tabs and overdue text', () => {
 const list = { items: [issue], total: 6, offset: 0, summary: { open: 6 } };
 assert.equal(v.tabLabel('OPEN', null), 'Đang mở');
 assert.equal(v.tabLabel('OPEN', list, 'RESOLVED'), 'Đang mở · 6');
 assert.equal(v.tabLabel('RESOLVED', list, 'RESOLVED'), 'Đã xử lý · 6');
 assert.equal(v.tabLabel('ALL', list, 'RESOLVED'), 'Tất cả');
 assert.equal(v.tabLabel('ALL', list, 'ALL'), 'Tất cả · 6');
 assert.equal(v.tabLabel('RESOLVED', list, 'ALL'), 'Đã xử lý');
 assert.match(v.pageRangeText(list, 'OPEN', Date.parse('2026-10-15T00:00:00Z')), /dòng nền đỏ/);
 assert.equal(v.pageRangeText({ ...list, offset: 10, total: 32, items: Array(10).fill(issue) }, 'RESOLVED'), 'Hiển thị 11–20 trong 32 báo cáo đã xử lý');
 assert.equal(v.clampOffset(20, 20), 0);
 assert.equal(v.pageCount(32), 2);
});
test('pilot page guard and nav entry', () => {
 const base = path.join(root, 'app/(signed-in)/(admin)/admin/code-issues');
 const page = readFileSync(path.join(base, 'page.tsx'), 'utf8');
 assert.match(page, /if \(PILOT_BUILD\) notFound\(\);/);
 const nav = readFileSync(path.join(root, 'components/layout/admin/admin-nav.ts'), 'utf8');
 assert.match(nav, /PILOT_BUILD \? \[\] : \[[\s\S]*?\/admin\/code-issues/);
});

test('mock queue integrates with view labels and refund toast', async () => {
 const { getResponse } = await import('msw');
 const { rewardsAdminHandlers } = await import('../mocks/handlers/rewards-admin.ts');
 const { resetStore, setCurrentUserId, setMockStorage } = await import('../mocks/legacy/store.ts');
 const { mockRepository } = await import('../mocks/legacy/repository.ts');
 const storage = new Map();
 const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
 setMockStorage(localStorage); resetStore(); setCurrentUserId('user-admin-004'); mockRepository.setLatency(0);
 globalThis.window = { location: { search: '?msw=default' }, localStorage };
 const response = await getResponse(rewardsAdminHandlers, new Request('http://localhost/api/admin/rewards/code-issues?status=OPEN&limit=20&offset=0'), { baseUrl: 'http://localhost' });
 assert.equal(response.status, 200);
 const list = schema.adminCodeIssueListSchema.parse((await response.json()).data);
 assert.equal(list.items.length, 6);
 assert.match(list.items[0].voucher.brand.name, /Phúc Long/);
 assert.deepEqual([...list.items].map(row => row.createdAt), [...list.items].map(row => row.createdAt).sort());
 for (const row of list.items) assert.equal(row.canReplace, row.replaceBlockedReason === null, row.reference);
 assert.equal(v.REPLACE_BLOCKED_COPY.NO_STOCK, 'Hết tồn kho.');
 const blockedRows = list.items.filter(row => row.replaceBlockedReason);
 assert.ok(blockedRows.length > 0);
 for (const row of blockedRows) assert.equal(typeof v.REPLACE_BLOCKED_COPY[row.replaceBlockedReason], 'string', row.reference);
 const highlands = list.items.find(row => row.voucher.brand.name.includes('Highlands'));
 assert.match(v.successToast('REFUND', highlands).title, new RegExp(`${highlands.pricePoints} điểm`));
});

test('error view actions, unknown codes and pagination edges', () => {
 const http = (code, status) => new ApiError({ kind: 'http', message: 'x', code, status });
 assert.equal(v.resolveErrorView(http('NO_REPLACEMENT_AVAILABLE', 409), issue).suggest, 'REFUND');
 assert.equal(v.resolveErrorView(http('REPLACEMENT_NOT_SUPPORTED', 409), issue).suggest, 'REFUND_OR_REJECT');
 assert.equal(v.resolveErrorView(http('TICKET_EXPIRED', 409), issue).suggest, 'REFUND');
 assert.equal(v.resolveErrorView(http('CODE_ISSUE_ALREADY_RESOLVED', 409), issue).showResult, true);
 assert.equal(v.resolveErrorView(http('TICKET_REFUNDED', 409), issue).showResult, true);
 assert.equal(v.resolveErrorView(http('CODE_ISSUE_NOT_FOUND', 404), issue).showResult, undefined);
 assert.equal(v.resolveErrorView(http('VALIDATION_FAILED', 400), issue).code, 'VALIDATION_FAILED');
 assert.equal(v.resolveErrorView(http(undefined, 403), issue).code, 'UNKNOWN');
 const list = { items: [issue], total: 6, offset: 0, summary: { open: 6 } };
 assert.equal(v.pageRangeText({ ...list, items: Array(6).fill(issue) }, 'OPEN', Date.parse('2026-10-15T00:00:00Z')), 'Hiển thị 1–6 trong 6 báo cáo · dòng nền đỏ đã quá 1 ngày làm việc');
 assert.equal(v.clampOffset(40, 40), 20);
 assert.equal(v.clampOffset(20, 21), 20);
});
test('code-issue screens never import mocks or read code values', () => {
 const base = path.join(root, 'app/(signed-in)/(admin)/admin/code-issues');
 const files = ['page.tsx', 'hooks/use-admin-code-issues.ts', ...['CodeIssuesScreen', 'CodeIssueDrawer', 'ResolveCodeIssueDialog', 'CodeIssueToasts'].map(name => `components/${name}.tsx`)];
 for (const file of [...files.map(file => path.join(base, file)), path.join(root, 'lib/admin/rewards-code-issues-view.ts')]) {
  const source = readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /from ["'][^"']*mocks\//, file);
  assert.doesNotMatch(source, /replacementCode|\b(issue|item|row)\.code\b/, file);
 }
});
