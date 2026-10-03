import test from "node:test";
import assert from "node:assert/strict";

/** Story IR.1 / owner decision 2026-10-03: the pilot admin shows the real missing-code count only. */
process.env.NEXT_PUBLIC_PILOT_BUILD = "true";

const { statCardsOf } = await import("../lib/admin/overview-view.ts");
const { ADMIN_NAV } = await import("../components/layout/admin/admin-nav.ts");

const overview = {
  pendingSurveys: { count: 0 },
  pendingTopUps: { count: 0, points: 0, amountVnd: 0 },
  openIssues: { disputes: 4, missingCodeReports: 2 },
  escrow: { points: 0, runningSurveys: 0 },
  todo: [],
};

test("pilot overview card counts and names only missing-code reports", () => {
  const card = statCardsOf(overview).find((c) => c.href === "/admin/disputes");
  assert.equal(card.value, "2");
  assert.equal(card.caption, "2 báo thiếu mã");
  assert.doesNotMatch(card.caption, /khiếu nại/);
});

test("pilot admin nav keeps the disputes badge and has no quality entry", () => {
  assert.equal(ADMIN_NAV.find((i) => i.href === "/admin/disputes")?.queue, "disputes");
  assert.equal(ADMIN_NAV.some((i) => i.queue === "quality" || i.href === "/admin/quality"), false);
});
