import test from "node:test";
import assert from "node:assert/strict";

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
