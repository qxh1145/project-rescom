import test from "node:test";
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

const {
  PAYOS_QUICK_AMOUNTS,
  PAYOS_TOP_UP_MIN_VND,
  PAYOS_TOP_UP_MAX_VND,
  POINT_VND_RATE,
  checkPayosAmount,
  pointsForVnd,
  isTerminal,
  isSafeCheckoutUrl,
  pollDeadline,
  shouldPoll,
  payosTimeline,
} = await import("../lib/wallet/payos-top-up.ts");
const { mergeTopUps } = await import("../lib/wallet/top-up-history.ts");
const { getResponse } = await import("msw");
const { topUpHandlers } = await import("../mocks/handlers/top-up.ts");

test("PayOS amounts and validation rules", async (t) => {
  await t.test("quick amounts are predefined multiples of 200", () => {
    assert.deepEqual(PAYOS_QUICK_AMOUNTS, [20000, 50000, 100000, 200000, 500000]);
    for (const amt of PAYOS_QUICK_AMOUNTS) {
      assert.equal(amt % POINT_VND_RATE, 0);
      assert.equal(amt >= PAYOS_TOP_UP_MIN_VND, true);
      assert.equal(amt <= PAYOS_TOP_UP_MAX_VND, true);
    }
  });

  await t.test("calculates Points for VNĐ correctly", () => {
    assert.equal(pointsForVnd(10_000), 50);
    assert.equal(pointsForVnd(20_000), 100);
    assert.equal(pointsForVnd(5_000_000), 25_000);
  });

  await t.test("validates VNĐ amounts with dots and spaces as thousands separators", () => {
    assert.deepEqual(checkPayosAmount("10.000"), { ok: true, amountVnd: 10_000 });
    assert.deepEqual(checkPayosAmount("10 000"), { ok: true, amountVnd: 10_000 });
    assert.deepEqual(checkPayosAmount("5.000.000"), { ok: true, amountVnd: 5_000_000 });
    assert.deepEqual(checkPayosAmount("5 000 000"), { ok: true, amountVnd: 5_000_000 });
  });

  await t.test("rejects invalid amounts and provides nearest valid suggestions", () => {
    // Under min (9.999)
    const under = checkPayosAmount("9.999");
    assert.equal(under.ok, false);
    if (!under.ok) {
      assert.equal(under.suggestion, 10_000);
    }

    // Over max (5.000.200)
    const over = checkPayosAmount("5.000.200");
    assert.equal(over.ok, false);
    if (!over.ok) {
      assert.equal(over.suggestion, 5_000_000);
    }

    // Not multiple of 200 (10.100 -> rounded nearest is 10.000 or 10.200)
    const nonMultiple = checkPayosAmount("10.100");
    assert.equal(nonMultiple.ok, false);
    if (!nonMultiple.ok) {
      assert.equal(typeof nonMultiple.suggestion, "number");
      assert.equal(nonMultiple.suggestion % 200, 0);
    }

    assert.ok([10_000, 10_200].includes(nonMultiple.suggestion));
    // Empty input
    assert.equal(checkPayosAmount("").ok, false);
    assert.equal(checkPayosAmount("abc").ok, false);
  });
});

test("isSafeCheckoutUrl", () => {
  assert.equal(isSafeCheckoutUrl("https://pay.payos.vn/web/abc"), true);
  assert.equal(isSafeCheckoutUrl("https://pay.payos.vn/web/abc", true), true);
  for (const bad of ["javascript:alert(1)", "http://pay.payos.vn/x", "//evil.example/x", "", null, undefined]) {
    assert.equal(isSafeCheckoutUrl(bad), false, String(bad));
    assert.equal(isSafeCheckoutUrl(bad, true), false, String(bad));
  }
  assert.equal(isSafeCheckoutUrl("/wallet/top-up/1"), false);
  assert.equal(isSafeCheckoutUrl("/wallet/top-up/1", true), true);
});

test("PayOS polling lifecycle rules", async (t) => {
  const expiresAtStr = "2026-10-15T12:00:00.000Z";
  const deadline = pollDeadline(expiresAtStr);
  assert.equal(deadline.toISOString(), "2026-10-15T12:02:00.000Z");

  await t.test("isTerminal identifies terminal statuses", () => {
    assert.equal(isTerminal("PROCESSING"), false);
    assert.equal(isTerminal("SUCCESSFUL"), true);
    assert.equal(isTerminal("CANCELLED"), true);
    assert.equal(isTerminal("EXPIRED"), true);
    assert.equal(isTerminal("AMOUNT_MISMATCH"), true);
    assert.equal(isTerminal("MANUAL_REFUNDED"), true);
  });

  await t.test("shouldPoll stops on terminal or past deadline", () => {
    const topUpProcessing = { status: "PROCESSING", expiresAt: expiresAtStr };
    // Before deadline
    assert.equal(shouldPoll(topUpProcessing, new Date("2026-10-15T12:01:59.000Z")), true);
    // After deadline (+2m)
    assert.equal(shouldPoll(topUpProcessing, new Date("2026-10-15T12:02:01.000Z")), false);

    // Boundary: exactly expiresAt + 2 min stops; 1 ms before still polls.
    assert.equal(shouldPoll(topUpProcessing, new Date("2026-10-15T12:02:00.000Z")), false);
    assert.equal(shouldPoll(topUpProcessing, new Date("2026-10-15T12:01:59.999Z")), true);

    // Terminal stops immediately even before deadline
    const topUpSuccess = { status: "SUCCESSFUL", expiresAt: expiresAtStr };
    assert.equal(shouldPoll(topUpSuccess, new Date("2026-10-15T11:59:00.000Z")), false);
  });
});

test("payosTimeline returns correct steps per status", () => {
  const base = {
    points: 100,
    createdAt: "2026-10-15T12:00:00.000Z",
    paidAt: null,
    cancelledAt: null,
  };

  const proc = payosTimeline({ ...base, status: "PROCESSING" });
  assert.equal(proc.length, 3);
  assert.equal(proc[0].state, "done");
  assert.equal(proc[1].state, "current");
  assert.equal(proc[2].state, "todo");

  const succ = payosTimeline({ ...base, status: "SUCCESSFUL", paidAt: "2026-10-15T12:01:00.000Z" });
  assert.equal(succ.every((s) => s.state === "done"), true);

  const canc = payosTimeline({ ...base, status: "CANCELLED", cancelledAt: "2026-10-15T12:01:00.000Z" });
  assert.equal(canc[1].state, "failed");

  const exp = payosTimeline({ ...base, status: "EXPIRED" });
  assert.equal(exp[1].state, "failed");

  const mis = payosTimeline({ ...base, status: "AMOUNT_MISMATCH" });
  assert.equal(mis[1].state, "failed");
  assert.equal(mis[2].state, "current");

  const ref = payosTimeline({ ...base, status: "MANUAL_REFUNDED" });
  assert.equal(ref[1].state, "done");
  assert.equal(ref[2].state, "todo");
});

test("Story 13.13 wallet retirement pins", async (t) => {
  await t.test("the mode is payos when availability is true", () => {
    const toMode = (availability) => (availability.payosEnabled ? "payos" : "manual");
    assert.equal(toMode({ payosEnabled: true }), "payos");
    assert.equal(toMode({ payosEnabled: false }), "manual");
  });

  await t.test("the mock manual POST /economy/top-ups returns 404 in default scenario", async () => {
    const req = new Request("http://localhost:3000/api/economy/top-ups", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "test-csrf-token",
      },
      body: JSON.stringify({ amount: 100 }),
    });
    const res = await getResponse(topUpHandlers, req, { baseUrl: "http://localhost:3000" });
    assert.ok(res, "handler matched");
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error?.code, "NOT_FOUND");
  });

  await t.test("mergeTopUps keeps MANUAL rows in payos mode", () => {
    const manualRow = {
      id: "manual-id-1",
      amount: 100,
      amountVnd: 20000,
      status: "APPROVED",
      transferReference: "RESCOM123456",
      createdAt: "2026-10-15T08:00:00.000Z",
    };
    const payosRow = {
      id: "payos-id-1",
      orderCode: 9999,
      amountVnd: 50000,
      points: 250,
      status: "SUCCESSFUL",
      checkoutUrl: null,
      expiresAt: "2026-10-15T10:35:00.000Z",
      cancelledAt: null,
      paidAt: "2026-10-15T10:32:00.000Z",
      createdAt: "2026-10-15T10:30:00.000Z",
    };
    const merged = mergeTopUps([manualRow], [payosRow], 10);
    assert.equal(merged.length, 2);
    const manualFound = merged.find((item) => item.channel === "MANUAL");
    assert.ok(manualFound, "manual row preserved in history");
    assert.equal(manualFound.code, "RESCOM123456");
    assert.equal(manualFound.points, 100);
  });
});

