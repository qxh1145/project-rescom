import test from "node:test";
import assert from "node:assert/strict";

const view = await import("../lib/admin/fraud-log-view.ts");
const service = await import("../lib/admin/fraud-log-service.ts");
const messages = await import("../lib/admin/fraud-log-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

const KHANG = "7f3a0c52-8d14-4e6b-9a21-3c5d7e9f1b01";

test("wrong completion codes (backend SECURITY_VIOLATION) show as COMPLETION_CODE", () => {
  const wrongCode = {
    type: "SECURITY_VIOLATION",
    details: { action: "COMPLETION_CODE_VERIFICATION_FAILED", failureCount: 3, isLocked: true },
  };
  assert.equal(view.fraudKindOf(wrongCode), "COMPLETION_CODE");
  assert.equal(view.fraudTypeLabel("COMPLETION_CODE"), "Sai mã hoàn thành");
  assert.equal(view.fraudDetailText(wrongCode), "Lần 3/3 · lượt làm bị khoá");
  assert.equal(
    view.fraudDetailText({ ...wrongCode, details: { ...wrongCode.details, failureCount: 1, isLocked: false } }),
    "Lần 1/3",
  );
  assert.equal(view.fraudKindOf({ type: "SECURITY_VIOLATION", details: null }), "SECURITY_VIOLATION");
  assert.equal(view.fraudTypeLabel("SOMETHING_NEW"), "SOMETHING_NEW");
});

test("detail column per type (Figma 11e)", () => {
  assert.equal(
    view.fraudDetailText({ type: "TIME_BARRIER", details: { elapsedSeconds: 48, requiredSeconds: 150 } }),
    "48 giây · tối thiểu 2 phút 30 giây",
  );
  assert.equal(
    view.fraudDetailText({ type: "TIME_BARRIER", details: { elapsedSeconds: 31, requiredSeconds: 60 } }),
    "31 giây · tối thiểu 1 phút",
  );
  assert.equal(
    view.fraudDetailText({ type: "RATE_LIMIT", details: { policyVersion: "participation-rate-limit-v1" } }),
    "participation-rate-limit-v1",
  );
  assert.equal(
    view.fraudDetailText({ type: "COMPLAINT_UPHELD", details: { refundedPoints: 10, adminName: "Admin Hùng" } }),
    "Trả 10 điểm về ký quỹ · Admin Hùng",
  );
  assert.equal(view.fraudDetailText({ type: "DEMO_MISMATCH", details: null }), "Chưa có");
  assert.equal(view.formatSecondsVi(0), "0 giây");
  assert.equal(view.formatSecondsVi(120), "2 phút");
});

test("user filter: ?userId= keeps the exact id until the admin edits the field", () => {
  assert.equal(view.initialUserText(KHANG), "#7F3A");
  assert.equal(view.initialUserText("#A901"), "#A901");
  assert.equal(view.initialUserText(null), "");
  assert.deepEqual(view.resolveUserFilter("#7F3A", KHANG), { userId: KHANG });
  assert.deepEqual(view.resolveUserFilter("#7f3a", KHANG), { userId: KHANG });
  assert.deepEqual(view.resolveUserFilter("#7F3", KHANG), { search: "#7F3" });
  assert.deepEqual(view.resolveUserFilter("  ", KHANG), {});
  assert.deepEqual(view.resolveUserFilter(KHANG, null), { userId: KHANG });
  assert.deepEqual(view.resolveUserFilter("khang", null), { search: "khang" });
});

test("window select and request params", () => {
  assert.equal(view.parseFraudWindow("14"), 14);
  assert.equal(view.parseFraudWindow(""), null);
  assert.equal(service.fraudLogSearch({ userId: KHANG, search: "x", days: 14 }), `userId=${KHANG}&days=14&limit=100`);
  assert.equal(
    service.fraudLogSearch({ search: " #A901 ", days: null, type: "RATE_LIMIT" }),
    "search=%23A901&type=RATE_LIMIT&limit=100",
  );
});

test("repeat banner (the system only flags)", () => {
  assert.deepEqual(view.repeatBannerOf({ userId: KHANG, count: 5, repeated: true, status: "ACTIVE" }, 14), {
    lead: "#7F3A vi phạm lặp lại",
    rest: " · 5 mục trong 14 ngày. Hệ thống chỉ gắn cờ, không tự khoá.",
  });
  assert.equal(
    view.repeatBannerOf({ userId: KHANG, count: 7, repeated: true, status: "LOCKED" }, null).rest,
    " · 7 mục. Tài khoản đã bị khoá.",
  );
});

test("fraud-log service parses the ASSUMED payload", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requested = "";
  globalThis.fetch = async (url) => {
    requested = String(url);
    return new Response(
      JSON.stringify({
        data: {
          items: [
            {
              id: "5eed0000-0000-4000-8000-000000000001",
              userId: KHANG,
              type: "RATE_LIMIT",
              survey: null,
              details: { policyVersion: "participation-rate-limit-v1" },
              createdAt: "2026-09-23T15:40:00.000Z",
            },
          ],
          total: 1,
          windowDays: 14,
          accounts: [{ userId: KHANG, count: 1, repeated: false, status: "ACTIVE" }],
          nextCursor: null,
          totalCapped: false,
          truncated: false,
        },
        error: null,
        meta: {},
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const page = await service.listFraudLog({ userId: KHANG, days: 14 });
  assert.equal(requested, `/api/admin/fraud-log?userId=${KHANG}&days=14&limit=100`);
  assert.equal(page.items[0].type, "RATE_LIMIT");
  assert.equal(page.accounts[0].repeated, false);
});

test("fraud-log query: the next-page cursor is sent as is", () => {
  const cursor = "2026-09-23T15:40:00.000Z:5eed0000-0000-4000-8000-000000000001";
  assert.equal(
    service.fraudLogSearch({ days: null, cursor }),
    `limit=100&cursor=${encodeURIComponent(cursor)}`,
  );
});

test("fraud-log totals: exact, or a lower bound past the backend cap", () => {
  assert.equal(messages.fraudLogTotalText({ total: 12, totalCapped: false }), "12 mục");
  assert.equal(messages.fraudLogTotalText({ total: 10_000, totalCapped: true }), "10 000+ mục");
  assert.match(messages.FRAUD_LOG_TRUNCATED_NOTE, /thu hẹp bộ lọc/);
});

test("fraud-log messages", () => {
  assert.match(messages.fraudLogLoadErrorMessage(new ApiError({ kind: "network", message: "x" })), /Không kết nối/);
  assert.match(
    messages.fraudLogLoadErrorMessage(new ApiError({ kind: "http", status: 404, message: "x" })),
    /chưa có trên máy chủ/,
  );
  assert.equal(messages.fraudLogLoadErrorMessage(new Error("x")), "Không tải được FraudLog. Vui lòng thử lại.");
  assert.match(
    messages.fraudLogLoadErrorMessage(
      new ApiError({ kind: "http", status: 403, code: "FORBIDDEN_RESOURCE", message: "x" }),
    ),
    /không có quyền quản trị/,
  );
});
