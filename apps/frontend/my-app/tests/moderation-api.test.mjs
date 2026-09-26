import test from "node:test";
import assert from "node:assert/strict";

const FORM_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() {
      return jsonResponse(status, body);
    },
  };
}

const queueItem = {
  formId: FORM_ID,
  formVersionId: VERSION_ID,
  versionNumber: 1,
  title: "Khảo sát thói quen học tập",
  description: null,
  type: "INTERNAL",
  status: "MODERATION_QUEUE",
  publisherId: "33333333-3333-4333-8333-333333333333",
  publisherEmail: "publisher@fpt.edu.vn",
  rewardPerResponse: 10,
  expectedCompletions: 50,
  effectiveRewardPerResponse: 8,
  escrowAmount: 400,
  estimatedEffortSeconds: 120,
  blocksCount: 1,
  externalUrl: null,
  targetingJson: null,
  targetingInvalid: false,
  isResubmission: false,
  submittedAt: "2026-09-26T10:00:00.000Z",
};

const decision = {
  id: "44444444-4444-4444-8444-444444444444",
  formId: FORM_ID,
  formVersionId: VERSION_ID,
  versionNumber: 1,
  outcome: "REJECTED",
  adminId: "55555555-5555-4555-8555-555555555555",
  reason: "Nội dung quảng cáo",
  refundAmount: 400,
  refundJournalId: "66666666-6666-4666-8666-666666666666",
  correlationId: "77777777-7777-4777-8777-777777777777",
  decidedAt: "2026-09-26T11:00:00.000Z",
};

test("Story 8.1: moderation live API client", async (t) => {
  const api = await import("../app/admin/moderation/moderation-api.ts");
  const originalFetch = globalThis.fetch;
  const calls = [];

  function installFetch(handler) {
    calls.length = 0;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === "/api/auth/csrf") {
        return jsonResponse(200, { data: { csrfToken: "csrf-token" } });
      }
      return handler(String(url), init);
    };
  }

  try {
    await t.test("lists the queue with pagination and validates the response", async () => {
      const page = { items: [queueItem], total: 3, limit: 1, offset: 1, hasMore: true };
      installFetch(() => jsonResponse(200, { data: page }));

      const result = await api.listModerationQueue({ limit: 1, offset: 1 });

      assert.deepEqual(result, page);
      assert.equal(calls[0].url, "/api/admin/moderation/surveys?limit=1&offset=1");
      assert.equal(calls[0].init.credentials, "same-origin");
    });

    await t.test("loads a preview", async () => {
      const preview = {
        ...queueItem,
        schemaJson: { schemaVersion: 1, title: "x", blocks: [] },
        decision: null,
        escrowHeld: 400,
        fundingShortfall: 0,
      };
      installFetch(() => jsonResponse(200, { data: preview }));

      const result = await api.getModerationSurvey(FORM_ID);

      assert.deepEqual(result, preview);
      assert.equal(calls[0].url, `/api/admin/moderation/surveys/${FORM_ID}`);
    });

    await t.test("approves with CSRF, the previewed version and a correlation id", async () => {
      const body = {
        decision: { ...decision, outcome: "APPROVED", reason: null, refundAmount: 0, refundJournalId: null },
        form: {
          id: FORM_ID,
          status: "PUBLISHED",
          currentVersionId: VERSION_ID,
          isPublished: true,
          publishedAt: "2026-09-26T11:00:00.000Z",
        },
        replayed: false,
      };
      installFetch(() => jsonResponse(200, { data: body }));

      const result = await api.approveSurvey(
        FORM_ID,
        { formVersionId: VERSION_ID },
        { correlationId: "77777777-7777-4777-8777-777777777777" },
      );

      assert.equal(result.form.status, "PUBLISHED");
      const call = calls.find((c) => c.url.endsWith("/approve"));
      assert.equal(call.url, `/api/admin/moderation/surveys/${FORM_ID}/approve`);
      assert.equal(call.init.method, "POST");
      assert.equal(call.init.body, JSON.stringify({ formVersionId: VERSION_ID }));
      const headers = new Headers(call.init.headers);
      assert.equal(headers.get("X-CSRF-Token"), "csrf-token");
      assert.equal(headers.get("X-Correlation-Id"), "77777777-7777-4777-8777-777777777777");
      assert.equal(headers.get("Content-Type"), "application/json");
    });

    await t.test("rejects with a reason", async () => {
      const body = {
        decision,
        form: {
          id: FORM_ID,
          status: "CLOSED",
          currentVersionId: VERSION_ID,
          isPublished: false,
          publishedAt: null,
        },
        replayed: false,
      };
      installFetch(() => jsonResponse(200, { data: body }));

      const result = await api.rejectSurvey(FORM_ID, {
        formVersionId: VERSION_ID,
        reason: "Nội dung quảng cáo",
      });

      assert.equal(result.decision.refundAmount, 400);
      const call = calls.find((c) => c.url.endsWith("/reject"));
      assert.deepEqual(JSON.parse(call.init.body), {
        formVersionId: VERSION_ID,
        reason: "Nội dung quảng cáo",
      });
    });

    await t.test("surfaces backend error codes and HTTP status", async () => {
      installFetch(() =>
        jsonResponse(409, {
          data: null,
          error: { code: "MODERATION_ALREADY_DECIDED", message: "Already moderated" },
        }),
      );

      await assert.rejects(
        api.approveSurvey(FORM_ID, { formVersionId: VERSION_ID }),
        (error) =>
          error.code === "MODERATION_ALREADY_DECIDED" &&
          error.status === 409 &&
          error.message === "Already moderated",
      );
    });

    await t.test("rejects malformed success payloads", async () => {
      installFetch(() => jsonResponse(200, { data: { items: "nope" } }));
      await assert.rejects(api.listModerationQueue(), /Phản hồi từ máy chủ không hợp lệ/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
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
