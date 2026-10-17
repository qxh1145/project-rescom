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
const { adminPayosTopUpHandlers } = await import("../mocks/handlers/admin-payos-top-ups.ts");
const { topUpHandlers } = await import("../mocks/handlers/top-up.ts");
const { payosTopUpsOf } = await import("../mocks/data/top-up.ts");
const { walletOf, updateWallet, transactionsOf } = await import("../mocks/data/economy.ts");
const { getMockSessionUser } = await import("../mocks/db/session.ts");
const { setCurrentUserId } = await import("../mocks/legacy/store.ts");

const ORIGIN = "http://localhost:3000";
const allHandlers = [...adminPayosTopUpHandlers, ...topUpHandlers];

async function postJson(endpoint, body) {
  const req = new Request(`${ORIGIN}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "test-csrf-token",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await getResponse(allHandlers, req, { baseUrl: ORIGIN });
  assert.ok(res, `handler matched POST ${endpoint}`);
  return { status: res.status, body: await res.json() };
}

async function getJson(endpoint) {
  const req = new Request(`${ORIGIN}${endpoint}`, {
    method: "GET",
  });
  const res = await getResponse(allHandlers, req, { baseUrl: ORIGIN });
  assert.ok(res, `handler matched GET ${endpoint}`);
  return { status: res.status, body: await res.json() };
}

test("Story 13.12 MSW admin refund resolution lifecycle", async (t) => {
  // Step 1: User submits a refund request
  setCurrentUserId("user-active-002");
  const user = await getMockSessionUser();
  assert.ok(user, "demo user found");

  const items = payosTopUpsOf(user);
  const eligibleItem = items.find(
    (it) => it.status === "SUCCESSFUL" && it.counterAccount && !it.refund?.request && !it.mismatchResolution,
  );
  assert.ok(eligibleItem, "eligible SUCCESSFUL top-up found");

  updateWallet(user, (wallet) => {
    wallet.available = 500;
  });

  const walletBefore = walletOf(user);
  const heldBeforeSubmit = walletBefore.refundHold ?? 0;

  const submitRes = await postJson(`/api/economy/top-ups/payos/${eligibleItem.id}/refund-request`, {
    reason: "WRONG_AMOUNT",
    note: "Admin resolution test",
  });
  assert.equal(submitRes.status, 200);
  const refundReqId = submitRes.body.data.request.id;
  assert.ok(refundReqId);

  const heldAfterSubmit = walletOf(user).refundHold ?? 0;
  assert.equal(heldAfterSubmit, heldBeforeSubmit + eligibleItem.points);

  // Switch to admin actor
  setCurrentUserId("user-admin-004");
  const admin = await getMockSessionUser();
  assert.equal(admin?.role, "ADMIN");

  await t.test("admin resolve REFUNDED -> user DTO REFUNDED + wallet refundHold decremented", async () => {
    const resolveRes = await postJson(`/api/admin/top-ups/refunds/${refundReqId}/resolve`, {
      decision: "REFUNDED",
      destinationConfirmed: true,
    });

    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.body.error, null);
    assert.equal(resolveRes.body.data.request.status, "REFUNDED");
    assert.equal(resolveRes.body.data.replayed, false);

    // Verify user wallet moved
    const updatedWallet = walletOf(user);
    assert.equal(updatedWallet.refundHold, heldBeforeSubmit);

    // Verify ledger entry
    const txs = transactionsOf(user);
    const resolveTx = txs.find((tx) => tx.id === `topup-refund-resolve:${refundReqId}`);
    assert.ok(resolveTx, "topup-refund-resolve transaction created");
    assert.equal(resolveTx.kind, "TOP_UP_REFUND");
    assert.equal(resolveTx.status, "HELD");
    assert.match(resolveTx.note, /order \d+/, "note matches backend description so history shows the order");

    // Backend parity: heldPoints is 0 once the request is no longer REQUESTED.
    const detail = await getJson(`/api/admin/top-ups/refunds/${refundReqId}`);
    assert.equal(detail.body.data.heldPoints, 0);
  });

  await t.test("user DTO reflects REFUNDED", async () => {
    setCurrentUserId("user-active-002");
    const getRes = await getJson(`/api/economy/top-ups/payos/${eligibleItem.id}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.refund.request.status, "REFUNDED");
    assert.ok(getRes.body.data.refund.request.resolvedAt);
  });

  await t.test("withdraw after resolve -> 409 REFUND_ALREADY_RESOLVED", async () => {
    setCurrentUserId("user-active-002");
    const withdrawRes = await postJson(`/api/economy/top-ups/payos/${eligibleItem.id}/refund-request/withdraw`);
    assert.equal(withdrawRes.status, 409);
    assert.equal(withdrawRes.body.error?.code, "REFUND_ALREADY_RESOLVED");
  });

  await t.test("bank transfer recording: once succeeds, twice -> 409", async () => {
    setCurrentUserId("user-admin-004");
    const submittedAt = (await getJson(`/api/admin/top-ups/refunds/${refundReqId}`)).body.data.submittedAt;
    const future = await postJson(`/api/admin/top-ups/refunds/${refundReqId}/bank-transfer`, {
      bankTransferReference: "BT-FUTURE",
      bankTransferredAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    assert.equal(future.status, 400);
    assert.equal(future.body.error?.code, "VALIDATION_ERROR");
    const beforeSubmit = await postJson(`/api/admin/top-ups/refunds/${refundReqId}/bank-transfer`, {
      bankTransferReference: "BT-PAST",
      bankTransferredAt: new Date(Date.parse(submittedAt) - 60_000).toISOString(),
    });
    assert.equal(beforeSubmit.status, 400);
    assert.equal(beforeSubmit.body.error?.code, "VALIDATION_ERROR");
    const firstBt = await postJson(`/api/admin/top-ups/refunds/${refundReqId}/bank-transfer`, {
      bankTransferReference: "BT-TEST-12345",
      bankTransferredAt: new Date().toISOString(),
    });
    assert.equal(firstBt.status, 200);
    assert.equal(firstBt.body.data.replayed, false);
    const secondBt = await postJson(`/api/admin/top-ups/refunds/${refundReqId}/bank-transfer`, {
      bankTransferReference: "BT-TEST-99999",
      bankTransferredAt: new Date().toISOString(),
    });
    assert.equal(secondBt.status, 409);
    assert.equal(secondBt.body.error?.code, "REFUND_BANK_TRANSFER_ALREADY_RECORDED");
  });

  await t.test("replay same resolve decision -> 200 replayed: true", async () => {
    setCurrentUserId("user-admin-004");
    const replayRes = await postJson(`/api/admin/top-ups/refunds/${refundReqId}/resolve`, {
      decision: "REFUNDED",
      destinationConfirmed: true,
    });
    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.body.data.replayed, true);
  });

  await t.test("resolve REFUNDED on hold-less request -> 409 REFUND_NOT_HELD", async () => {
    setCurrentUserId("user-admin-004");
    // List to find a NOT_ELIGIBLE request
    const listRes = await getJson("/api/admin/top-ups/refunds?verdict=NOT_ELIGIBLE");
    assert.equal(listRes.status, 200);
    const notEligible = listRes.body.data.items[0];
    assert.ok(notEligible, "not-eligible request found in seed");

    const resolveRes = await postJson(`/api/admin/top-ups/refunds/${notEligible.id}/resolve`, {
      decision: "REFUNDED",
      destinationConfirmed: true,
    });
    assert.equal(resolveRes.status, 409);
    assert.equal(resolveRes.body.error?.code, "REFUND_NOT_HELD");
  });

  await t.test("reject hold-less request with manualTransferRecorded=true and replay without field -> 200 replayed: true", async () => {
    setCurrentUserId("user-admin-004");
    const listRes = await getJson("/api/admin/top-ups/refunds?status=OPEN&verdict=NOT_ELIGIBLE");
    assert.equal(listRes.status, 200);
    const notEligible = listRes.body.data.items[0];
    if (notEligible) {
      const rejectRes = await postJson(`/api/admin/top-ups/refunds/${notEligible.id}/resolve`, {
        decision: "REJECTED",
        reason: "Offline refund completed",
        manualTransferRecorded: true,
      });
      assert.equal(rejectRes.status, 200);
      assert.equal(rejectRes.body.data.replayed, false);

      const replayRes = await postJson(`/api/admin/top-ups/refunds/${notEligible.id}/resolve`, {
        decision: "REJECTED",
        reason: "Offline refund completed",
      });
      assert.equal(replayRes.status, 200);
      assert.equal(replayRes.body.data.replayed, true);
    }
  });

  await t.test("reject with manualTransferRecorded=true on held request -> 400 VALIDATION_ERROR", async () => {
    setCurrentUserId("user-admin-004");
    const listRes = await getJson("/api/admin/top-ups/refunds?status=OPEN&verdict=ELIGIBLE");
    assert.equal(listRes.status, 200);
    const heldReq = listRes.body.data.items[0];
    assert.ok(heldReq, "open eligible request found");

    const rejectRes = await postJson(`/api/admin/top-ups/refunds/${heldReq.id}/resolve`, {
      decision: "REJECTED",
      reason: "Invalid",
      manualTransferRecorded: true,
    });
    assert.equal(rejectRes.status, 400);
    assert.equal(rejectRes.body.error?.code, "VALIDATION_ERROR");
  });

  await t.test("self-review forbidden -> 403 TOPUP_SELF_REVIEW_FORBIDDEN", async () => {
    const { loadStore, saveStore } = await import("../mocks/legacy/store.ts");
    const store = loadStore();
    const oldRole = store.users["user-active-002"].role;
    store.users["user-active-002"].role = "ADMIN";
    saveStore(store);

    setCurrentUserId("user-active-002");
    const selfRes = await postJson(`/api/admin/top-ups/refunds/${refundReqId}/resolve`, {
      decision: "REJECTED",
      reason: "Self review test",
    });
    assert.equal(selfRes.status, 403);
    assert.equal(selfRes.body.error?.code, "TOPUP_SELF_REVIEW_FORBIDDEN");

    const selfBt = await postJson(`/api/admin/top-ups/refunds/${refundReqId}/bank-transfer`, {
      bankTransferReference: "SELF-BT",
    });
    assert.equal(selfBt.status, 403);
    assert.equal(selfBt.body.error?.code, "TOPUP_SELF_REVIEW_FORBIDDEN");

    store.users["user-active-002"].role = oldRole;
    saveStore(store);
  });

  await t.test("list pagination and unmasked account number in detail", async () => {
    setCurrentUserId("user-admin-004");
    const listRes = await getJson("/api/admin/top-ups/refunds");
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.data.pageSize, 10);

    const firstId = listRes.body.data.items[0]?.id;
    assert.ok(firstId);

    const detailRes = await getJson(`/api/admin/top-ups/refunds/${firstId}`);
    assert.equal(detailRes.status, 200);
    const dest = detailRes.body.data.destination;
    assert.ok(dest);
    if (dest.accountNumber) {
      assert.ok(!dest.accountNumber.startsWith("****"), "account number must be unmasked");
    }
  });
});

