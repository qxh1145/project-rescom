import { test } from "node:test";
import assert from "node:assert/strict";

const stored = new Map();
const localStorageMock = {
  getItem: (key) => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
  clear: () => stored.clear(),
};
globalThis.localStorage = localStorageMock;
globalThis.window = {
  location: { search: "?msw=default" },
  localStorage: localStorageMock,
};

const { register } = await import("node:module");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const loader = `import { existsSync, statSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const file = path.join(${JSON.stringify(root)}, specifier.slice(2));
    for (const f of [file + '.ts', file, path.join(file, 'index.ts'), file + '.tsx']) {
      if (existsSync(f) && statSync(f).isFile()) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
  }
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return nextResolve(specifier, context);
  if (!context.parentURL?.startsWith('file:')) return nextResolve(specifier, context);
  const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  for (const file of [base, base + '.ts', path.join(base, 'index.ts'), base + '.tsx']) {
    if (existsSync(file) && statSync(file).isFile()) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const { getResponse } = await import("msw");
const { topUpHandlers } = await import("../mocks/handlers/top-up.ts");
const { payosTopUpsOf } = await import("../mocks/data/top-up.ts");
const { walletOf, updateWallet, transactionsOf } = await import("../mocks/data/economy.ts");
const { getMockSessionUser } = await import("../mocks/db/session.ts");
const { setCurrentUserId } = await import("../mocks/legacy/store.ts");

const ORIGIN = "http://localhost:3000";

async function postJson(endpoint, body) {
  const req = new Request(`${ORIGIN}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "test-csrf-token",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await getResponse(topUpHandlers, req, { baseUrl: ORIGIN });
  assert.ok(res, `handler matched POST ${endpoint}`);
  return { status: res.status, body: await res.json() };
}

test("Story 13.11 MSW refund request & withdraw lifecycle", async (t) => {
  setCurrentUserId("user-active-002");
  const user = await getMockSessionUser();
  assert.ok(user, "demo user found");
  assert.equal(user.email, "minh.le@fpt.edu.vn");

  // Initial user items seeded
  const items = payosTopUpsOf(user);
  const eligibleItem = items.find(
    (it) => it.status === "SUCCESSFUL" && it.counterAccount && !it.refund?.request && !it.mismatchResolution,
  );
  assert.ok(eligibleItem, "seeded eligible SUCCESSFUL top-up found");

  // Ensure wallet has enough available points for this top-up
  updateWallet(user, (wallet) => {
    wallet.available = 500;
  });

  const initialWallet = { ...walletOf(user) };
  const points = eligibleItem.points;
  assert.ok(initialWallet.available >= points, "wallet has enough available points");

  let submittedReqId = "";

  await t.test("submit eligible refund -> wallet available decreases, refundHold increases, ledger entry added", async () => {
    const res = await postJson(`/api/economy/top-ups/payos/${eligibleItem.id}/refund-request`, {
      reason: "WRONG_AMOUNT",
      note: "Test refund note",
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.replayed, false);
    const reqDto = res.body.data.request;
    assert.equal(reqDto.status, "REQUESTED");
    assert.equal(reqDto.eligibility, "ELIGIBLE");
    assert.equal(reqDto.reason, "WRONG_AMOUNT");
    assert.equal(reqDto.points, points);
    submittedReqId = reqDto.id;

    // Verify wallet mutation
    const updatedWallet = walletOf(user);
    assert.equal(updatedWallet.available, initialWallet.available - points);
    assert.equal(updatedWallet.refundHold, (initialWallet.refundHold ?? 0) + points);

    // Verify ledger entry
    const txs = transactionsOf(user);
    const holdTx = txs.find((tx) => tx.id === `topup-refund-hold:${eligibleItem.id}`);
    assert.ok(holdTx, "topup-refund-hold transaction created in ledger");
    assert.equal(holdTx.kind, "TOP_UP_REFUND_HOLD");
    assert.equal(holdTx.amount, -points);
    assert.equal(holdTx.status, "HELD");
  });

  await t.test("resubmit -> 409 TOPUP_REFUND_ALREADY_REQUESTED", async () => {
    const res = await postJson(`/api/economy/top-ups/payos/${eligibleItem.id}/refund-request`, {
      reason: "WRONG_AMOUNT",
      note: "Test refund note",
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, "TOPUP_REFUND_ALREADY_REQUESTED");
  });

  await t.test("withdraw refund -> wallet restored, ledger entry topup-refund-withdraw added", async () => {
    const res = await postJson(`/api/economy/top-ups/payos/${eligibleItem.id}/refund-request/withdraw`);

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.replayed, false);
    const reqDto = res.body.data.request;
    assert.equal(reqDto.id, submittedReqId);
    assert.equal(reqDto.status, "WITHDRAWN");
    assert.ok(reqDto.withdrawnAt);

    // Verify wallet restored
    const updatedWallet = walletOf(user);
    assert.equal(updatedWallet.available, initialWallet.available);
    assert.equal(updatedWallet.refundHold, initialWallet.refundHold ?? 0);

    // Verify ledger entry
    const txs = transactionsOf(user);
    const withdrawTx = txs.find((tx) => tx.id === `topup-refund-withdraw:${eligibleItem.id}`);
    assert.ok(withdrawTx, "topup-refund-withdraw transaction created in ledger");
    assert.equal(withdrawTx.kind, "TOP_UP_REFUND_RELEASE");
    assert.equal(withdrawTx.amount, points);
    assert.equal(withdrawTx.status, "AVAILABLE");
  });

  await t.test("re-withdraw -> 200 { request, replayed: true }", async () => {
    const res = await postJson(`/api/economy/top-ups/payos/${eligibleItem.id}/refund-request/withdraw`);

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.replayed, true);
    assert.equal(res.body.data.request.status, "WITHDRAWN");

    // Wallet stays untouched
    const updatedWallet = walletOf(user);
    assert.equal(updatedWallet.available, initialWallet.available);
    assert.equal(updatedWallet.refundHold, initialWallet.refundHold ?? 0);
  });
});
