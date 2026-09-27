import test from "node:test";
import assert from "node:assert/strict";

const status = await import("../lib/forms/manage-status.ts");
const reopen = await import("../lib/forms/manage-reopen.ts");
const view = await import("../lib/forms/manage-view.ts");
const messages = await import("../lib/forms/manage-messages.ts");
const service = await import("../lib/forms/manage-service.ts");

const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-27T03:00:00.000Z");

function facts(overrides = {}) {
  return {
    status: "PUBLISHED",
    rejection: null,
    pausedAt: null,
    completedCompletions: 0,
    expectedCompletions: 10,
    escrowLocked: 0,
    closeKind: null,
    ...overrides,
  };
}

/** The four surveys of Figma 10 (63:127). */
const FIGMA_FORMS = [
  facts({ status: "MODERATION_QUEUE", escrowLocked: 100 }),
  facts({ status: "PUBLISHED", completedCompletions: 6, escrowLocked: 40 }),
  facts({ status: "CLOSED", completedCompletions: 20, expectedCompletions: 20, closeKind: "OWNER" }),
  facts({ status: "DRAFT", rejection: { reason: "Form yêu cầu đăng nhập.", refundedPoints: 120 } }),
];

test("Figma 10 pills: backend statuses map to Chờ duyệt / Đang chạy / Đủ mẫu / Bị từ chối", () => {
  const labels = FIGMA_FORMS.map((form) => status.STATUS_PILLS[status.statusViewOf(form)].label);
  assert.deepEqual(labels, ["Chờ duyệt", "Đang chạy", "Đủ mẫu", "Bị từ chối"]);
});

test("status view covers legacy ESCROW_LOCKED, paused, early close and plain drafts", () => {
  assert.equal(status.statusViewOf(facts({ status: "ESCROW_LOCKED" })), "PENDING_REVIEW");
  assert.equal(status.statusViewOf(facts({ pausedAt: "2026-09-26T00:00:00.000Z" })), "PAUSED");
  assert.equal(status.statusViewOf(facts({ status: "CLOSED", completedCompletions: 3 })), "ENDED");
  assert.equal(status.statusViewOf(facts({ status: "DRAFT" })), "DRAFT");
  assert.equal(status.statusViewOf(facts({ status: "CLOSED", expectedCompletions: 0 })), "ENDED");
});

test("filter tabs: rejected and drafts only under Tất cả, paused counts as Đang chạy", () => {
  assert.equal(status.matchesFilter("REJECTED", "all"), true);
  assert.equal(status.matchesFilter("REJECTED", "ended"), false);
  assert.equal(status.matchesFilter("PAUSED", "running"), true);
  assert.equal(status.matchesFilter("PENDING_REVIEW", "pending"), true);
  assert.equal(status.matchesFilter("FULL", "ended"), true);
  assert.equal(status.matchesFilter("RUNNING", "ended"), false);
});

test("Figma 10 stat cards: 1 running · 1 waiting · 140 points locked · 26 completions", () => {
  assert.deepEqual(status.aggregateStats(FIGMA_FORMS), { running: 1, pendingReview: 1, escrowLocked: 140, completed: 26 });
  assert.deepEqual(status.aggregateStats([]), { running: 0, pendingReview: 0, escrowLocked: 0, completed: 0 });
});

test("reopen is offered only for a survey its owner closed (decision E8-D1)", () => {
  assert.equal(status.canReopen({ status: "CLOSED", closeKind: "OWNER" }), true);
  assert.equal(status.canReopen({ status: "CLOSED", closeKind: "ADMIN" }), false);
  assert.equal(status.canReopen({ status: "CLOSED", closeKind: "MODERATION" }), false);
  assert.equal(status.canReopen({ status: "CLOSED", closeKind: null }), false);
  assert.equal(status.canReopen({ status: "PUBLISHED", closeKind: "OWNER" }), false);
});

test("Sửa & gửi lại goes to the Google Forms wizard or the Form Builder by type", () => {
  assert.equal(status.resubmitHref({ id: "abc", type: "EXTERNAL" }), "/forms/new/google-form?from=abc");
  assert.equal(status.resubmitHref({ id: "abc", type: "INTERNAL" }), "/forms/abc/builder");
  assert.equal(status.resultsHref({ id: "abc", type: "INTERNAL" }), "/forms/abc/responses");
  assert.equal(status.resultsHref({ id: "abc", type: "EXTERNAL" }), "/forms/abc");
});

test("reopen cost uses the backend escrow draw (Form Builder −20%)", () => {
  const internal = reopen.reopenCost({
    type: "INTERNAL",
    rewardPerResponse: 12,
    expectedCompletions: 20,
    additionalCompletions: 8,
    available: 112,
  });
  assert.equal(internal.perCompletion, 10);
  assert.equal(internal.total, 80);
  assert.equal(internal.remaining, 32);
  assert.equal(internal.discounted, true);
  assert.equal(internal.affordable, true);

  const external = reopen.reopenCost({
    type: "EXTERNAL",
    rewardPerResponse: 12,
    expectedCompletions: 20,
    additionalCompletions: 8,
    available: 90,
  });
  assert.deepEqual([external.perCompletion, external.total, external.remaining, external.discounted], [12, 96, -6, false]);
  assert.equal(external.affordable, false);
});

test("reopen cost rejects an empty or oversized quota and tolerates an unknown balance", () => {
  const base = { type: "EXTERNAL", rewardPerResponse: 10, expectedCompletions: 99_995, available: null };
  const zero = reopen.reopenCost({ ...base, additionalCompletions: 0 });
  assert.equal(zero.validQuantity, false);
  assert.equal(zero.total, 0);
  const tooMany = reopen.reopenCost({ ...base, additionalCompletions: 6 });
  assert.equal(tooMany.maxAdditional, 5);
  assert.equal(tooMany.validQuantity, false);
  const unknown = reopen.reopenCost({ ...base, additionalCompletions: 5 });
  assert.equal(unknown.remaining, null);
  assert.equal(unknown.affordable, true);
  assert.equal(reopen.clampAdditional(0, 5), 1);
  assert.equal(reopen.clampAdditional(9, 5), 5);
  assert.equal(reopen.clampAdditional(Number.NaN, 5), 1);
});

test("tracking text: durations, deadlines, hours left in the 48h review", () => {
  assert.equal(view.formatDuration(460), "7 phút 40 giây");
  assert.equal(view.formatDuration(480), "8 phút");
  assert.equal(view.formatDuration(45), "45 giây");
  assert.equal(view.daysUntil(new Date(NOW + 8.2 * 24 * HOUR).toISOString(), NOW), 9);
  assert.equal(view.daysUntil(null, NOW), null);
  assert.equal(view.hoursUntil(new Date(NOW + 30.5 * HOUR).toISOString(), NOW), 31);
  assert.equal(view.hoursUntil(new Date(NOW - HOUR).toISOString(), NOW), 0);
  assert.equal(view.percentOf(8, 47), 17);
  assert.equal(view.percentOf(2, 0), 0);
});

test("Figma 10a opens summary: 47 opens, busiest Thursday (12)", () => {
  const summary = view.opensSummary({
    range: "day",
    buckets: ["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((label, index) => ({
      label,
      count: [4, 9, 6, 12, 8, 5, 3][index],
    })),
  });
  assert.deepEqual(summary, { window: "7 ngày qua", total: 47, peak: "thứ Năm", peakIndex: 3, max: 12 });
  const empty = view.opensSummary({ range: "week", buckets: [{ label: "Tuần 1", count: 0 }] });
  assert.equal(empty.peak, null);
  assert.equal(empty.total, 0);
});

test("survey header meta lines (Figma 10a / 17)", () => {
  const base = {
    ...facts(),
    rewardPerResponse: 10,
    estimatedDurationMinutes: 8,
    questionCount: null,
    audienceLabel: "Marketing, QTKD · 18–25 tuổi",
    closedAt: null,
    currentVersion: { schemaJson: { blocks: [] } },
  };
  assert.equal(
    view.headerMeta({ ...base, type: "EXTERNAL" }),
    "Google Forms · 8 phút · 10 điểm/lượt · Marketing, QTKD · 18–25 tuổi",
  );
  assert.equal(view.headerMeta({ ...base, type: "EXTERNAL" }, true), "Google Forms · 8 phút · 10 điểm/lượt");
  assert.equal(
    view.headerMeta({
      ...base,
      type: "INTERNAL",
      status: "CLOSED",
      completedCompletions: 20,
      expectedCompletions: 20,
      rewardPerResponse: 12,
      estimatedDurationMinutes: 6,
      questionCount: 8,
      audienceLabel: null,
      closedAt: "2026-09-22T05:00:00.000Z",
    }),
    "Form Builder · 8 câu hỏi · 6 phút · 12 điểm/lượt · kết thúc 22/09/2026",
  );
});

test("complaint form needs an issue and a 10+ character description", () => {
  assert.deepEqual(Object.keys(messages.validateDisputeDraft({ reason: null, description: "" })).sort(), ["description", "reason"]);
  assert.deepEqual(messages.validateDisputeDraft({ reason: "LOW_EFFORT", description: "  Trả lời abc cho mọi câu  " }), {});
});

test("the VERIFIED FormSummaryDto parses without the ASSUMED management fields", () => {
  const parsed = service.publisherFormSummarySchema.parse({
    id: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f01",
    publisherId: "11111111-1111-4111-8111-111111111111",
    type: "EXTERNAL",
    status: "PUBLISHED",
    title: "Thói quen đọc sách",
    description: null,
    rewardPerResponse: 10,
    expectedCompletions: 10,
    estimatedDurationMinutes: 8,
    latestVersionNumber: 1,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
  assert.equal(parsed.completedCompletions, 0);
  assert.equal(parsed.escrowLocked, 0);
  assert.equal(parsed.rejection, null);
  assert.equal(parsed.closeKind, null);
  assert.equal(parsed.hiddenFromMarketplace, false);
});
