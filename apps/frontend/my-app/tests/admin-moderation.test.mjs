import test from "node:test";
import assert from "node:assert/strict";

const service = await import("../lib/admin/moderation-service.ts");
const view = await import("../lib/admin/moderation-view.ts");
const messages = await import("../lib/admin/moderation-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

const FORM_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

const queueItem = {
  formId: FORM_ID,
  formVersionId: VERSION_ID,
  versionNumber: 1,
  title: "Hành vi tiêu dùng của sinh viên Marketing",
  description: "Khảo sát phục vụ đồ án tốt nghiệp ngành Marketing. Câu trả lời được ẩn danh.",
  type: "EXTERNAL",
  status: "MODERATION_QUEUE",
  publisherId: "33333333-3333-4333-8333-333333333333",
  publisherEmail: "linh.nt@fpt.edu.vn",
  rewardPerResponse: 10,
  expectedCompletions: 10,
  effectiveRewardPerResponse: 10,
  escrowAmount: 100,
  estimatedEffortSeconds: 360,
  blocksCount: 0,
  externalUrl: "https://docs.google.com/forms/d/e/x/viewform",
  targetingJson: { ageRange: { min: 18, max: 25 }, schools: ["Trường Đại học FPT – Đà Nẵng"] },
  targetingInvalid: false,
  isResubmission: false,
  submittedAt: "2026-09-26T12:30:00.000Z",
  publisherName: "Linh N.",
  publisherFraudLogCount: 0,
  deadlineAt: "2026-10-10T12:30:00.000Z",
};

const decision = {
  id: "44444444-4444-4444-8444-444444444444",
  formId: FORM_ID,
  formVersionId: VERSION_ID,
  versionNumber: 1,
  outcome: "REJECTED",
  adminId: "55555555-5555-4555-8555-555555555555",
  reason: "Thiếu mã hoàn thành ở trang cảm ơn",
  refundAmount: 100,
  refundJournalId: "66666666-6666-4666-8666-666666666666",
  correlationId: "77777777-7777-4777-8777-777777777777",
  decidedAt: "2026-09-26T13:00:00.000Z",
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("admin moderation service (VERIFIED /admin/moderation/surveys)", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  function installFetch(handler) {
    calls.length = 0;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === "/api/auth/csrf") return jsonResponse(200, { data: { csrfToken: "csrf-token" } });
      return handler(String(url), init);
    };
  }

  await t.test("lists one page of the queue and keeps the ASSUMED extensions", async () => {
    const page = { items: [queueItem], total: 1, limit: 50, offset: 0, hasMore: false };
    installFetch(() => jsonResponse(200, { data: page, error: null, meta: {} }));
    const result = await service.listModerationQueue();
    assert.deepEqual(result, page);
    assert.equal(calls[0].url, "/api/admin/moderation/surveys?limit=50");
    assert.equal(calls[0].init.credentials, "same-origin");
  });

  await t.test("parses a backend item without the extensions", async () => {
    const bare = { ...queueItem, targetingJson: null };
    delete bare.publisherName;
    delete bare.publisherFraudLogCount;
    delete bare.deadlineAt;
    installFetch(() => jsonResponse(200, { data: { items: [bare], total: 3, limit: 1, offset: 1, hasMore: true } }));
    const result = await service.listModerationQueue({ limit: 1, offset: 1 });
    assert.equal(result.items[0].publisherName, undefined);
    assert.equal(calls[0].url, "/api/admin/moderation/surveys?limit=1&offset=1");
  });

  await t.test("loads a preview", async () => {
    const preview = { ...queueItem, schemaJson: null, decision: null, escrowHeld: 100, fundingShortfall: 0 };
    installFetch(() => jsonResponse(200, { data: preview }));
    const result = await service.getModerationSurvey(FORM_ID);
    assert.equal(result.escrowHeld, 100);
    assert.equal(calls[0].url, `/api/admin/moderation/surveys/${FORM_ID}`);
  });

  await t.test("approves the previewed version with CSRF", async () => {
    const body = {
      decision: { ...decision, outcome: "APPROVED", reason: null, refundAmount: 0, refundJournalId: null },
      form: { id: FORM_ID, status: "PUBLISHED", currentVersionId: VERSION_ID, isPublished: true, publishedAt: "2026-09-26T13:00:00.000Z" },
      replayed: false,
    };
    installFetch(() => jsonResponse(200, { data: body }));
    const result = await service.approveModerationSurvey(FORM_ID, VERSION_ID);
    assert.equal(result.form.status, "PUBLISHED");
    const call = calls.find((c) => c.url.endsWith("/approve"));
    assert.equal(call.url, `/api/admin/moderation/surveys/${FORM_ID}/approve`);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.body, JSON.stringify({ formVersionId: VERSION_ID }));
    assert.equal(call.init.headers["X-CSRF-Token"], "csrf-token");
  });

  await t.test("rejects with a reason and returns the refund", async () => {
    const body = {
      decision,
      form: { id: FORM_ID, status: "CLOSED", currentVersionId: VERSION_ID, isPublished: false, publishedAt: null },
      replayed: false,
    };
    installFetch(() => jsonResponse(200, { data: body }));
    const result = await service.rejectModerationSurvey(FORM_ID, { formVersionId: VERSION_ID, reason: decision.reason });
    assert.equal(result.decision.refundAmount, 100);
    const call = calls.find((c) => c.url.endsWith("/reject"));
    assert.deepEqual(JSON.parse(call.init.body), { formVersionId: VERSION_ID, reason: decision.reason });
  });

  await t.test("surfaces backend codes as ApiError", async () => {
    installFetch(() =>
      jsonResponse(409, { data: null, error: { code: "MODERATION_ALREADY_DECIDED", message: "Already moderated" } }),
    );
    await assert.rejects(service.approveModerationSurvey(FORM_ID, VERSION_ID), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "MODERATION_ALREADY_DECIDED");
      assert.equal(messages.isStaleDecisionError(error), true);
      return true;
    });
  });

  await t.test("rejects malformed payloads", async () => {
    installFetch(() => jsonResponse(200, { data: { items: "nope" } }));
    await assert.rejects(service.listModerationQueue(), (error) => error instanceof ApiError && error.kind === "malformed");
  });
});

test("moderationErrorMessage: Vietnamese copy, never the raw message", () => {
  const fallback = "Không tải được hàng chờ duyệt khảo sát.";
  const http = (status, code, details) => new ApiError({ kind: "http", status, code, message: "raw", details });

  assert.equal(
    messages.moderationErrorMessage(http(403, "MODERATION_SELF_REVIEW_FORBIDDEN"), fallback),
    "Bạn không thể tự duyệt khảo sát do chính mình đăng.",
  );
  assert.equal(
    messages.moderationErrorMessage(http(403, "MODERATION_ADMIN_CAPABILITY_REQUIRED"), fallback),
    "Tài khoản quản trị của bạn không còn hoạt động. Vui lòng đăng nhập lại.",
  );
  assert.equal(messages.moderationErrorMessage(http(403, "SOMETHING"), fallback), "Bạn không có quyền duyệt khảo sát.");
  assert.match(messages.moderationErrorMessage(http(409, "MODERATION_VERSION_MISMATCH"), fallback), /vừa cập nhật/);
  for (const code of ["MODERATION_ALREADY_DECIDED", "FORM_NOT_IN_MODERATION_QUEUE"]) {
    assert.equal(
      messages.moderationErrorMessage(http(409, code), fallback),
      "Khảo sát này đã được xử lý hoặc không còn trong hàng chờ.",
    );
  }
  for (const code of ["MODERATION_INVALID_REQUEST", "VALIDATION_ERROR"]) {
    assert.equal(messages.moderationErrorMessage(http(400, code), fallback), "Yêu cầu không hợp lệ. Vui lòng tải lại trang.");
  }
  assert.match(messages.moderationErrorMessage(http(404, "FORM_NOT_FOUND"), fallback), /Không tìm thấy khảo sát/);
  assert.match(
    messages.moderationErrorMessage(http(409, "MODERATION_ESCROW_NOT_FUNDED", { shortfall: 120 }), fallback),
    /còn thiếu 120 điểm/,
  );
  assert.doesNotMatch(
    messages.moderationErrorMessage(http(409, "MODERATION_ESCROW_NOT_FUNDED"), fallback),
    /còn thiếu/,
  );
  for (const code of ["FORM_VALIDATION_ERROR", "EXTERNAL_COMPLETION_CODE_REQUIRED"]) {
    assert.match(messages.moderationErrorMessage(http(422, code), fallback), /không đạt điều kiện xuất bản/);
  }
  assert.match(
    messages.moderationErrorMessage(new ApiError({ kind: "network", message: "offline" }), fallback),
    /Không kết nối được máy chủ/,
  );
  assert.equal(messages.moderationErrorMessage(http(500, "INTERNAL_SERVER_ERROR"), fallback), fallback);
  assert.equal(messages.moderationErrorMessage(new Error("Some raw backend message"), fallback), fallback);
  assert.equal(messages.moderationErrorMessage(null, fallback), fallback);
});

test("Decision E8-D2: rejecting a re-submission warns that the live survey closes for good", () => {
  const warning = messages.rejectionImpactWarning({ isResubmission: true, versionNumber: 3 });
  assert.ok(warning);
  assert.match(warning, /phiên bản chỉnh sửa v3/);
  assert.match(warning, /đóng vĩnh viễn toàn bộ khảo sát/);
  assert.match(warning, /phiên bản đã duyệt trước đó \(v2\)/);
  assert.match(warning, /không thể mở lại/);
  assert.equal(messages.rejectionImpactWarning({ isResubmission: false, versionNumber: 1 }), null);
});

test("Figma 11a presentation rules", () => {
  assert.equal(view.surveySourceLabel("EXTERNAL"), "Google Forms");
  assert.equal(view.surveySourceLabel("INTERNAL"), "Trong Rescom");
  assert.equal(view.queueCardMeta(queueItem), "Linh N. · Google Forms · 26/09 19:30");
  assert.equal(view.publisherLabel({ publisherName: null, publisherEmail: "ha.vo@fpt.edu.vn" }), "ha.vo");
  assert.equal(view.publisherLabel({ publisherEmail: null }), "Người đăng");

  assert.equal(view.effortBandLabel(4 * 60), "Dưới 5 phút");
  assert.equal(view.effortBandLabel(6 * 60), "5 đến 10 phút");
  assert.equal(view.effortBandLabel(13 * 60), "10 đến 15 phút");
  assert.equal(view.effortBandLabel(20 * 60), "Trên 15 phút");

  assert.equal(view.formatDeadline("2026-10-10T12:30:00.000Z"), "10/10/2026");
  assert.equal(view.formatDeadline(null), "Chưa có");
  assert.equal(view.formatDeadline(undefined), "Chưa có");

  assert.equal(
    view.targetingSummary({
      ageRange: { min: 18, max: 25 },
      fieldOfStudy: ["Marketing & Truyền thông", "Kinh tế & Quản trị kinh doanh"],
      schools: ["Trường Đại học FPT – Đà Nẵng"],
      locations: ["Đà Nẵng"],
    }),
    "Tất cả giới tính · 18 đến 25 tuổi · Marketing & Truyền thông, Kinh tế & Quản trị kinh doanh · ĐH FPT Đà Nẵng · Đà Nẵng",
  );
  assert.equal(view.targetingSummary({ genders: ["FEMALE"], ageRange: { min: 20, max: 20 } }), "Nữ · 20 tuổi");
  assert.match(view.targetingSummary(null), /Mọi người dùng/);
  assert.match(view.targetingSummary(null, true), /không hợp lệ/);
});

test("checklist applies per survey type and gates approval", () => {
  assert.equal(view.checklistFor("EXTERNAL").length, 4);
  assert.deepEqual(
    view.checklistFor("INTERNAL").map((item) => item.id),
    ["content", "length"],
  );
  const queued = { status: "MODERATION_QUEUE", targetingInvalid: false, fundingShortfall: 0 };
  assert.equal(view.approvalBlocker(queued, true), null);
  assert.equal(view.approvalBlocker(queued, false), "checklist");
  assert.equal(view.approvalBlocker({ ...queued, fundingShortfall: 20 }, true), "notFunded");
  assert.equal(view.approvalBlocker({ ...queued, targetingInvalid: true }, true), "targetingInvalid");
  assert.equal(view.approvalBlocker({ ...queued, status: "PUBLISHED" }, true), "notQueued");
});

test("composeRejectionReason builds the backend reason (5–500 chars)", () => {
  assert.deepEqual(view.composeRejectionReason(null, "abc"), { ok: false, error: "reasonRequired" });
  assert.deepEqual(view.composeRejectionReason("missing-code", "  "), {
    ok: true,
    reason: "Thiếu mã hoàn thành ở trang cảm ơn",
  });
  assert.deepEqual(view.composeRejectionReason("login-required", "  Tắt giới hạn   tổ chức. "), {
    ok: true,
    reason: "Form yêu cầu đăng nhập, người ngoài không mở được. Tắt giới hạn tổ chức.",
  });
  assert.deepEqual(view.composeRejectionReason("other", ""), { ok: false, error: "noteRequired" });
  assert.deepEqual(view.composeRejectionReason("other", "abc"), { ok: false, error: "noteTooShort" });
  assert.equal(view.composeRejectionReason("other", "Quảng cáo trá hình").ok, true);
  const room = view.rejectionNoteMaxLength("missing-code");
  assert.equal(room, 500 - "Thiếu mã hoàn thành ở trang cảm ơn".length - 2);
  assert.equal(view.composeRejectionReason("missing-code", "x".repeat(room)).ok, true);
  assert.deepEqual(view.composeRejectionReason("missing-code", "x".repeat(room + 1)), { ok: false, error: "tooLong" });
  assert.equal(view.rejectionNoteMaxLength(null), 500);
});

test("refund preview and selection after a decision", () => {
  assert.equal(view.refundPreview({ escrowHeld: 80, escrowAmount: 100 }), 80);
  assert.equal(view.refundPreview({ escrowHeld: null, escrowAmount: 100 }), 100);

  assert.equal(view.nextSelection(["a", "b", "c"], "a"), "b");
  assert.equal(view.nextSelection(["a", "b", "c"], "b"), "c");
  assert.equal(view.nextSelection(["a", "b", "c"], "c"), "b");
  assert.equal(view.nextSelection(["a"], "a"), null);
  assert.equal(view.nextSelection(["a", "b"], "z"), "a");
  assert.equal(view.nextSelection([], "z"), null);
});

test("Story 8.1: publisher status presentation", async () => {
  const status = await import("../app/forms/form-status.ts");
  assert.equal(status.formStatusLabel("MODERATION_QUEUE"), "Chờ kiểm duyệt");
  assert.equal(status.formStatusLabel("PUBLISHED"), "Đang hoạt động");
  assert.equal(status.formStatusLabel("DRAFT"), "Bản nháp");
  assert.equal(status.formStatusLabel("CLOSED"), "Đã đóng");
  assert.equal(status.formStatusLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.match(status.formStatusBadgeClass("MODERATION_QUEUE"), /violet/);
  assert.equal(status.isAwaitingModeration("MODERATION_QUEUE"), true);
  assert.equal(status.isAwaitingModeration("PUBLISHED"), false);
  assert.equal(status.PUBLISH_TARGET_STATUS, "MODERATION_QUEUE");
});
