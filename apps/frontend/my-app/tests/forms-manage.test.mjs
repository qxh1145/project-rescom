import test from "node:test";
import assert from "node:assert/strict";

const status = await import("../lib/forms/manage-status.ts");
const reopen = await import("../lib/forms/manage-reopen.ts");
const view = await import("../lib/forms/manage-view.ts");
const messages = await import("../lib/forms/manage-messages.ts");
const service = await import("../lib/forms/manage-service.ts");
const resubmit = await import("../lib/forms/resubmit-service.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

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
  facts({
    status: "CLOSED",
    closeKind: "MODERATION",
    rejection: { reason: "Form yêu cầu đăng nhập.", refundedPoints: 120 },
  }),
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

test("a moderation rejection (CLOSED + MODERATION) is Bị từ chối, never Đã kết thúc or reopenable", () => {
  const rejected = facts({ status: "CLOSED", closeKind: "MODERATION", expectedCompletions: 10 });
  assert.equal(status.statusViewOf(rejected), "REJECTED");
  // The ASSUMED rejection details are optional: the VERIFIED close kind decides.
  assert.equal(status.statusViewOf({ ...rejected, rejection: null }), "REJECTED");
  assert.equal(status.canReopen(rejected), false);
  // Legacy DRAFT + rejection still reads as rejected.
  assert.equal(status.statusViewOf(facts({ status: "DRAFT", rejection: { reason: "x", refundedPoints: 0 } })), "REJECTED");
  // Other closes keep their pills; an unknown close kind (list item without it) is Đã kết thúc.
  assert.equal(status.statusViewOf(facts({ status: "CLOSED", closeKind: "ADMIN" })), "ENDED");
  assert.equal(status.statusViewOf(facts({ status: "CLOSED", closeKind: undefined, completedCompletions: 10 })), "FULL");
  assert.deepEqual(status.aggregateStats([rejected]), { running: 0, pendingReview: 0, escrowLocked: 0, completed: 0 });
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

test("reopen refusal follows the backend order and needs an approved current version (Story 8.1)", () => {
  const owner = { status: "CLOSED", closeKind: "OWNER" };
  assert.equal(status.reopenRefusalOf({ ...owner, currentVersion: { isPublished: true } }), null);
  assert.equal(status.reopenRefusalOf({ ...owner, currentVersion: { isPublished: false } }), "VERSION_NOT_APPROVED");
  // Unknown on list items: the server decides.
  assert.equal(status.reopenRefusalOf(owner), null);
  assert.equal(
    status.reopenRefusalOf({ status: "CLOSED", closeKind: "MODERATION", currentVersion: { isPublished: false } }),
    "CLOSED_BY_ADMIN_OR_MODERATION",
  );
  assert.equal(status.reopenRefusalOf({ status: "DRAFT", closeKind: null }), "NOT_CLOSED");
  assert.equal(status.canReopen({ ...owner, currentVersion: { isPublished: false } }), false);
});

test("FORM_NOT_REOPENABLE copy is chosen by details.reason", () => {
  const refused = (details) =>
    new ApiError({ kind: "http", message: "x", status: 409, code: "FORM_NOT_REOPENABLE", details });
  const fallback = "Chưa mở lại được khảo sát.";
  assert.match(
    messages.formActionErrorMessage(refused({ reason: "VERSION_NOT_APPROVED", closeKind: "OWNER" }), fallback),
    /chưa được Admin duyệt/,
  );
  assert.match(
    messages.formActionErrorMessage(refused({ reason: "CLOSED_BY_ADMIN_OR_MODERATION", closeKind: "ADMIN" }), fallback),
    /gỡ hoặc từ chối/,
  );
  assert.equal(messages.formActionErrorMessage(refused(undefined), fallback), "Khảo sát này không mở lại được.");
  assert.match(messages.reopenRefusalMessage("NOT_CLOSED"), /đã kết thúc/);
});

test("Sửa & gửi lại: Google Forms → prefilled wizard; in-Rescom → copy dialog; drafts continue in place", () => {
  assert.equal(status.resubmitHref({ id: "abc", type: "EXTERNAL" }), "/forms/new/google-form?from=abc");
  assert.equal(status.resubmitHref({ id: "abc", type: "INTERNAL" }), "/forms/abc/resubmit");
  assert.equal(status.continueDraftHref({ id: "abc", type: "INTERNAL" }), "/forms/abc/builder");
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
  // Phase 5 M1: an unknown Escrow is null (no "hoàn 0 điểm" promise), never 0.
  assert.equal(parsed.escrowLocked, null);
  assert.equal(parsed.rejection, null);
  assert.equal(parsed.closeKind, null);
  assert.equal(parsed.hiddenFromMarketplace, false);
});

test("Phase 5 M2: the backend summary fields parse (closeKind, completedCompletions, escrowLocked)", () => {
  const parsed = service.publisherFormSummarySchema.parse({
    id: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f03",
    publisherId: "11111111-1111-4111-8111-111111111111",
    type: "INTERNAL",
    status: "CLOSED",
    title: "Nhu cầu nhà trọ",
    rewardPerResponse: 12,
    expectedCompletions: 20,
    latestVersionNumber: 2,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    closeKind: "OWNER",
    completedCompletions: 20,
    escrowLocked: 0,
  });
  assert.equal(parsed.closeKind, "OWNER");
  assert.equal(parsed.completedCompletions, 20);
  assert.equal(parsed.escrowLocked, 0);
  assert.equal(status.statusViewOf(parsed), "FULL");
  assert.equal(service.publisherFormSummarySchema.parse({ ...parsed, escrowLocked: null }).escrowLocked, null);
});

test("Phase 5 M1: the Escrow stat is unknown (null) only when no survey reports it", () => {
  assert.equal(status.aggregateStats([facts({ escrowLocked: null }), facts({ escrowLocked: null })]).escrowLocked, null);
  assert.equal(status.aggregateStats([facts({ escrowLocked: null }), facts({ escrowLocked: 40 })]).escrowLocked, 40);
  assert.equal(status.aggregateStats([]).escrowLocked, 0);
});

test("Phase 5 M2: list rows offer Mở lại for an owner close and, as a stopgap, an unknown close kind", () => {
  assert.equal(status.listOffersReopen(facts({ status: "CLOSED", closeKind: "OWNER" })), true);
  assert.equal(status.listOffersReopen(facts({ status: "CLOSED", closeKind: null })), true);
  assert.equal(status.listOffersReopen(facts({ status: "CLOSED", closeKind: undefined })), true);
  assert.equal(status.listOffersReopen(facts({ status: "CLOSED", closeKind: "ADMIN" })), false);
  assert.equal(status.listOffersReopen(facts({ status: "CLOSED", closeKind: "MODERATION" })), false);
  assert.equal(status.listOffersReopen(facts({ status: "PUBLISHED" })), false);
  // The reopen page still decides from the detail (fail closed on null).
  assert.equal(status.canReopen(facts({ status: "CLOSED", closeKind: null })), false);
});

test("Phase 5 M3: pause/resume stays hidden without a backend route", () => {
  assert.equal(service.PAUSE_SUPPORTED, false);
});

test("Phase 5 M7: Rút lại for a queued survey and a re-versioned draft only", () => {
  assert.equal(status.canWithdraw(facts({ status: "MODERATION_QUEUE" }), 1), true);
  assert.equal(status.canWithdraw(facts({ status: "ESCROW_LOCKED" }), 1), true);
  assert.equal(status.canWithdraw(facts({ status: "DRAFT" }), 2), true);
  assert.equal(status.canWithdraw(facts({ status: "DRAFT" }), 1), false);
  assert.equal(status.canWithdraw(facts({ status: "PUBLISHED" }), 3), false);
  assert.equal(status.canWithdraw(facts({ status: "CLOSED", closeKind: "OWNER" }), 2), false);
  const refused = new ApiError({ kind: "http", message: "x", status: 400, code: "INVALID_STATUS_TRANSITION" });
  assert.match(messages.formActionErrorMessage(refused, "fallback"), /chưa từng được đăng/);
});

test("Phase 5 M6: every page of GET /forms is loaded (capped at 20) and a moved survey is kept once", async () => {
  const pageOf = (page, totalPages, ids) => ({
    forms: ids.map((id) => ({ id })),
    total: 999,
    page,
    limit: 100,
    totalPages,
  });
  const asked = [];
  const three = await service.collectPublisherFormPages(async (page) => {
    asked.push(page);
    return pageOf(page, 3, page === 1 ? ["a", "b"] : page === 2 ? ["b", "c"] : ["d"]);
  });
  assert.deepEqual(asked.sort(), [1, 2, 3]);
  assert.deepEqual(three.forms.map((form) => form.id), ["a", "b", "c", "d"]);
  assert.equal(three.page, 1);

  let calls = 0;
  await service.collectPublisherFormPages(async (page) => {
    calls += 1;
    return pageOf(page, 50, [`f${page}`]);
  });
  assert.equal(calls, service.PUBLISHER_FORMS_MAX_PAGES);

  let single = 0;
  const one = await service.collectPublisherFormPages(async (page) => {
    single += 1;
    return pageOf(page, 1, ["only"]);
  });
  assert.equal(single, 1);
  assert.deepEqual(one.forms.map((form) => form.id), ["only"]);
});

test("Phase 5 M6: pages after the first are loaded sequentially, not in parallel", async () => {
  const started = [];
  const finished = [];
  await service.collectPublisherFormPages(async (page) => {
    started.push(page);
    // If pages ran in parallel, page 3's start would be recorded before page 2 finishes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    finished.push(page);
    return { forms: [{ id: `f${page}` }], total: 3, page, limit: 100, totalPages: 3 };
  });
  assert.deepEqual(started, [1, 2, 3]);
  assert.deepEqual(finished, [1, 2, 3]);
  // Each page must finish before the next one starts.
  for (let i = 1; i < started.length; i += 1) {
    assert.ok(
      finished.indexOf(started[i - 1]) < started.indexOf(started[i]),
      `page ${started[i - 1]} should finish before page ${started[i]} starts`,
    );
  }
});

// --- "Sửa & gửi lại" of a rejected in-Rescom survey: POST /forms + PATCH /forms/:id/draft ---

const BLOCK = {
  id: "q-1",
  order: 0,
  type: "single_choice",
  title: "Bạn học năm mấy?",
  required: true,
  options: [
    { id: "o1", label: "Năm 1", value: "Năm 1" },
    { id: "o2", label: "Năm 2", value: "Năm 2" },
  ],
};

function rejectedSource(id, overrides = {}) {
  return {
    id,
    type: "INTERNAL",
    title: "Thói quen học nhóm của sinh viên",
    description: "Khoảng 5 phút.",
    rewardPerResponse: 12,
    expectedCompletions: 30,
    estimatedDurationMinutes: 5,
    currentVersion: {
      schemaJson: {
        id: "def-old",
        schemaVersion: 1,
        title: "Thói quen học nhóm của sinh viên",
        blocks: [BLOCK],
        sections: [{ id: "s1", title: "Phần 1", blockIds: ["q-1"] }],
        metadata: { expectedEffortSeconds: 300, minTimeBarrierSeconds: 15 },
      },
      targetingJson: { ageRange: { min: 18, max: 25 } },
    },
    ...overrides,
  };
}

const COPY_ID = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";

function builderForm(updatedAt, extra = {}) {
  return {
    id: COPY_ID,
    type: "INTERNAL",
    status: "DRAFT",
    title: "Thói quen học nhóm của sinh viên",
    rewardPerResponse: 12,
    expectedCompletions: 30,
    currentVersion: { versionNumber: 1, schemaJson: {} },
    updatedAt,
    ...extra,
  };
}

/** Fake `apiRequest`: records calls, answers from a script. */
function fakeRequest(script) {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, method: options.method ?? "GET", body: options.body });
    const answer = script(path, options.method ?? "GET", calls.length);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { request, calls };
}

test("copy payload keeps the definition, targeting, reward, sample and duration", () => {
  const payload = resubmit.copyPayloadOf(rejectedSource("src-payload"));
  assert.equal(payload.title, "Thói quen học nhóm của sinh viên");
  assert.equal(payload.description, "Khoảng 5 phút.");
  assert.equal(payload.rewardPerResponse, 12);
  assert.equal(payload.expectedCompletions, 30);
  assert.equal(payload.estimatedDurationMinutes, 5);
  assert.deepEqual(payload.targetingJson, { ageRange: { min: 18, max: 25 } });
  assert.equal(payload.schema.title, "Thói quen học nhóm của sinh viên");
  assert.equal("id" in payload.schema, false);
  assert.deepEqual(payload.schema.blocks.map((block) => block.id), ["q-1"]);
  assert.deepEqual(payload.schema.sections, [{ id: "s1", title: "Phần 1", blockIds: ["q-1"] }]);

  const broken = resubmit.copyPayloadOf(
    rejectedSource("src-broken", {
      estimatedDurationMinutes: null,
      currentVersion: { schemaJson: { blocks: "nope" }, targetingJson: { schools: ["x"] } },
    }),
  );
  assert.equal("schema" in broken, false);
  assert.equal("targetingJson" in broken, false);
  assert.equal("estimatedDurationMinutes" in broken, false);
});

test("copy = POST /forms then PATCH /forms/:newId/draft with the returned updatedAt", async () => {
  const { request, calls } = fakeRequest((path, method) =>
    method === "POST" ? builderForm("2026-09-27T10:00:00.000Z") : builderForm("2026-09-27T10:00:01.000Z"),
  );
  const copy = await resubmit.copyRejectedForm(rejectedSource("src-ok"), request);
  assert.equal(copy.id, COPY_ID);
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.path}`),
    ["POST /forms", `PATCH /forms/${COPY_ID}/draft`],
  );
  assert.deepEqual(calls[0].body, { title: "Thói quen học nhóm của sinh viên", type: "INTERNAL" });
  assert.equal(calls[1].body.clientUpdatedAt, "2026-09-27T10:00:00.000Z");
  assert.equal(calls[1].body.schema.blocks.length, 1);
  assert.equal(resubmit.copyBuilderHref(copy), `/forms/${COPY_ID}/builder`);
});

test("a double click creates one copy", async () => {
  const { request, calls } = fakeRequest((path, method) => builderForm(method === "POST" ? "2026-09-27T10:00:00.000Z" : "2026-09-27T10:00:01.000Z"));
  const source = rejectedSource("src-double");
  const [first, second] = await Promise.all([
    resubmit.copyRejectedForm(source, request),
    resubmit.copyRejectedForm(source, request),
  ]);
  assert.equal(first, second);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("a failed fill is retried on the same copy instead of creating another", async () => {
  let failPatch = true;
  const { request, calls } = fakeRequest((path, method) => {
    if (method === "PATCH" && failPatch) {
      failPatch = false;
      return new ApiError({ kind: "network", message: "offline" });
    }
    if (method === "GET") return builderForm("2026-09-27T10:05:00.000Z");
    return builderForm("2026-09-27T10:00:00.000Z");
  });
  const source = rejectedSource("src-retry");
  await assert.rejects(resubmit.copyRejectedForm(source, request), (error) => error.kind === "network");
  assert.match(messages.resubmitCopyErrorMessage(new ApiError({ kind: "network", message: "x" })), /kết nối/);
  await resubmit.copyRejectedForm(source, request);
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.path}`),
    ["POST /forms", `PATCH /forms/${COPY_ID}/draft`, `GET /forms/${COPY_ID}`, `PATCH /forms/${COPY_ID}/draft`],
  );
  assert.equal(calls[3].body.clientUpdatedAt, "2026-09-27T10:05:00.000Z");
});

test("Google Forms surveys are never copied through the builder", async () => {
  const { request, calls } = fakeRequest(() => builderForm("2026-09-27T10:00:00.000Z"));
  await assert.rejects(resubmit.copyRejectedForm(rejectedSource("src-ext", { type: "EXTERNAL" }), request));
  assert.equal(calls.length, 0);
});

test("Chỉnh sửa: only a running or paused Form Builder survey re-versions (POST /forms/:id/versions needs PUBLISHED)", () => {
  const internal = (overrides) => ({ ...facts(overrides), type: "INTERNAL" });
  assert.equal(status.canEditLive(internal({ status: "PUBLISHED" })), true);
  assert.equal(status.canEditLive(internal({ status: "PUBLISHED", pausedAt: "2026-09-27T00:00:00.000Z" })), true);
  assert.equal(status.canEditLive({ ...facts({ status: "PUBLISHED" }), type: "EXTERNAL" }), false);
  assert.equal(status.canEditLive(internal({ status: "DRAFT" })), false);
  assert.equal(status.canEditLive(internal({ status: "MODERATION_QUEUE" })), false);
  assert.equal(status.canEditLive(internal({ status: "CLOSED", closeKind: "OWNER" })), false);
});

test("createdFormVersionSchema: interruptedAttempts defaults to 0", () => {
  const detail = {
    id: "f1",
    publisherId: "u1",
    type: "INTERNAL",
    status: "DRAFT",
    title: "T",
    rewardPerResponse: 10,
    expectedCompletions: 30,
    currentVersion: { id: "v2", versionNumber: 2 },
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
  assert.equal(service.createdFormVersionSchema.parse(detail).interruptedAttempts, 0);
  assert.equal(service.createdFormVersionSchema.parse({ ...detail, interruptedAttempts: 2 }).interruptedAttempts, 2);
});

test("Xoá: only a never-published draft (DELETE /forms/:id → backend deleteDraft)", () => {
  assert.equal(status.canDelete(facts({ status: "DRAFT" }), 1), true);
  // A draft past v1 was re-versioned from a published survey: it withdraws instead.
  assert.equal(status.canDelete(facts({ status: "DRAFT" }), 2), false);
  assert.equal(status.canDelete(facts({ status: "DRAFT", rejection: { reason: "x", refundedPoints: 0 } }), 1), false);
  assert.equal(status.canDelete(facts({ status: "MODERATION_QUEUE" }), 1), false);
  assert.equal(status.canDelete(facts({ status: "PUBLISHED" }), 1), false);
  assert.equal(status.canDelete(facts({ status: "CLOSED", closeKind: "OWNER" }), 1), false);
});

test("Xoá: backend refusals read in Vietnamese", () => {
  for (const code of ["FORM_NOT_IN_DRAFT_STATUS", "FORM_HAS_PUBLISHED_VERSIONS"]) {
    const error = new ApiError({ kind: "http", status: 409, code, message: code });
    assert.notEqual(messages.formActionErrorMessage(error, "fallback"), "fallback");
  }
});
