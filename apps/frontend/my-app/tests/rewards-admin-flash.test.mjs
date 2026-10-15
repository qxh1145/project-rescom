import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

test('flash handlers guard session, admin role, CSRF, body and unknown id', async () => {
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
    assert.equal((await call('GET', 'flash-sales')).status, 401);
    setCurrentUserId('user-new-001');
    assert.equal((await call('GET', 'flash-sales')).status, 403);
    setCurrentUserId('user-admin-004');
    const csrf = await call('POST', 'flash-sales', {}, false);
    assert.equal(csrf.status, 403);
    assert.equal(csrf.body.error.code, 'AUTH_INVALID_CSRF_TOKEN');
    const invalid = await call('POST', 'flash-sales', {});
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.error.details);
    const unknown = await call('GET', 'flash-sales/00000000-0000-4000-8000-000000000001');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, 'FLASH_SALE_NOT_FOUND');
    const range = await call('GET', 'stats?from=2026-01-01&to=2028-01-01');
    assert.equal(range.status, 400);
    assert.ok(range.body.error.details);
    // Valid create / read / update / end flow, and 409 with every conflict listed.
    const V3 = '00000000-0000-4000-8000-000000000003', ACTIVE = '00000000-0000-4000-8000-000000000101';
    const startsAt = new Date(Date.now() + 2 * 86400000).toISOString(), endsAt = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString();
    const item = { voucherId: V3, flashPoints: 80, quota: 3, perUserCap: 1 };
    const conflict = await call('POST', 'flash-sales', { title: 'Xung đột', startsAt, endsAt, items: [{ ...item, flashPoints: 9999, quota: 99999 }] });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'FLASH_PRICE_NOT_BELOW_REGULAR');
    assert.deepEqual(new Set(conflict.body.error.details.conflicts.map(c => c.code)), new Set(['FLASH_PRICE_NOT_BELOW_REGULAR', 'FLASH_QUOTA_EXCEEDS_STOCK']));
    const created = await call('POST', 'flash-sales', { title: 'Flash thử', startsAt, endsAt, items: [item] });
    assert.equal(created.status, 201);
    const flashId = created.body.data.flashSale.id;
    assert.equal(created.body.data.flashSale.title, 'Flash thử');
    assert.equal((await call('GET', `flash-sales/${flashId}`)).status, 200);
    const updated = await call('PUT', `flash-sales/${flashId}`, { title: 'Flash sửa', startsAt, endsAt, items: [{ ...item, quota: 4 }] });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.flashSale.items[0].quota, 4);
    assert.equal((await call('PUT', 'flash-sales/00000000-0000-4000-8000-000000000999', { title: 'x', startsAt, endsAt, items: [item] })).body.error.code, 'FLASH_SALE_NOT_FOUND');
    assert.equal((await call('POST', `flash-sales/${flashId}/end`, { reason: 'WRONG_PRICE' })).body.error.code, 'FLASH_NOT_ACTIVE');
    assert.equal((await call('POST', `flash-sales/${ACTIVE}/end`, { reason: 'OTHER' })).status, 400);
    const ended = await call('POST', `flash-sales/${ACTIVE}/end`, { reason: 'WRONG_PRICE' });
    assert.equal(ended.status, 200);
    assert.equal(ended.body.data.flashSale.status, 'ENDED');
    assert.equal((await call('POST', `flash-sales/${ACTIVE}/end`, { reason: 'WRONG_PRICE' })).body.error.code, 'FLASH_ALREADY_ENDED');
    assert.equal((await call('GET', 'stats?from=2026-01-01&to=2026-01-31')).status, 200);
  } finally {
    setMockStorage(null);
    setCurrentUserId(original);
    delete globalThis.window;
  }
});

test('source guards: service self-gates every function, no mocks/ imports in UI, form reuses the real FlashSaleCard', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const service = readFileSync(path.join(root, 'lib/admin/rewards-flash-service.ts'), 'utf8');
  const bodies = service.split(/^export function /m).slice(1);
  assert.ok(bodies.length >= 6);
  for (const fn of bodies) assert.match(fn, /if \(!REWARDS_ENABLED\) throw/, fn.split('(')[0]);
  const walk = dir => readdirSync(dir).flatMap(name => { const file = path.join(dir, name); return statSync(file).isDirectory() ? walk(file) : [file]; });
  const ui = [...walk(path.join(root, 'app/(signed-in)/(admin)/admin/flash-sales')), ...walk(path.join(root, 'app/(signed-in)/(admin)/admin/voucher-stats'))].filter(file => /\.tsx?$/.test(file));
  for (const file of ui) assert.doesNotMatch(readFileSync(file, 'utf8'), /from ["'][^"']*\/mocks\//, file);
  const form = readFileSync(path.join(root, 'app/(signed-in)/(admin)/admin/flash-sales/components/FlashSaleFormScreen.tsx'), 'utf8');
  assert.match(form, /import \{ FlashSaleCard \} from "@\/app\/\(signed-in\)\/\(app\)\/rewards\/components\/FlashSaleCard"/);
  assert.ok(!ui.some(file => /FlashSaleCard\.tsx$/.test(file)));
});
