import test from "node:test";
import assert from "node:assert/strict";

const view = await import("../lib/admin/users-view.ts");
const service = await import("../lib/admin/users-service.ts");
const messages = await import("../lib/admin/users-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

const KHANG = "7f3a0c52-8d14-4e6b-9a21-3c5d7e9f1b01";

const verifiedUser = {
  id: KHANG,
  email: "khang.do@gmail.com",
  role: "RESPONDENT",
  status: "ACTIVE",
  createdAt: "2026-09-20T02:12:00.000Z",
  updatedAt: "2026-09-20T02:12:00.000Z",
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("short code, title and status of a user (Figma 11d)", () => {
  assert.equal(view.shortCodeOf(KHANG), "#7F3A");
  assert.equal(
    view.userTitleOf({ id: KHANG, email: "khang.do@gmail.com", name: "Đỗ Khang", fraudLog: { count14d: 5, repeated: true } }),
    "#7F3A · Đỗ Khang",
  );
  assert.equal(
    view.userTitleOf({ id: KHANG, email: "linh.nt@fpt.edu.vn", name: "Linh N.", fraudLog: { count14d: 0, repeated: false } }),
    "Linh N.",
  );
  assert.equal(view.userTitleOf({ id: KHANG, email: "a@b.vn", name: null }), "a@b.vn");

  assert.deepEqual(view.userStatusView({ status: "LOCKED", activated: true }), { label: "Đã khoá", tone: "danger" });
  assert.deepEqual(view.userStatusView({ status: "ACTIVE", activated: false }), { label: "Chưa kích hoạt", tone: "neutral" });
  assert.deepEqual(view.userStatusView({ status: "ACTIVE" }), { label: "Hoạt động", tone: "teal" });
});

test("FraudLog cell flags only an active repeat offender", () => {
  assert.deepEqual(view.fraudCellOf({ status: "ACTIVE", fraudLog: { count14d: 5, repeated: true } }), {
    text: "5 · lặp lại",
    flagged: true,
  });
  assert.deepEqual(view.fraudCellOf({ status: "LOCKED", fraudLog: { count14d: 7, repeated: true } }), {
    text: "7",
    flagged: false,
  });
  assert.deepEqual(view.fraudCellOf({ status: "ACTIVE", fraudLog: { count14d: 2, repeated: false } }), {
    text: "2",
    flagged: false,
  });
  assert.deepEqual(view.fraudCellOf({ status: "ACTIVE" }), { text: "—", flagged: false });
});

test("profile and account lines", () => {
  assert.equal(
    view.profileLineOf({ age: 21, gender: "MALE", location: "Đà Nẵng", occupation: "Sinh viên", fieldOfStudy: "Công nghệ thông tin" }),
    "21 tuổi · Nam · Đà Nẵng · Sinh viên · Công nghệ thông tin",
  );
  assert.equal(view.profileLineOf({ age: null, gender: null, location: " ", occupation: null, fieldOfStudy: null }), null);
  assert.equal(view.profileLineOf(null), null);
  assert.equal(view.accountLineOf({ email: "khang.do@gmail.com", signInMethod: "GOOGLE" }), "khang.do@gmail.com · đăng nhập Google");
  assert.equal(view.accountLineOf({ email: "x@y.vn" }), "x@y.vn");
  assert.equal(view.formatCount(undefined), "—");
  assert.equal(view.formatCount(1340), "1.340");
});

test("dates are local day/month", () => {
  const iso = new Date(2026, 8, 26, 15, 31).toISOString();
  assert.equal(view.formatDayMonth(iso), "26/09");
  assert.equal(view.formatDayMonthTime(iso), "26/09 15:31");
  assert.equal(view.formatDayMonth("nope"), "—");
});

test("lock reason is required and self actions are blocked", () => {
  assert.match(view.lockReasonError("  "), /Nhập lý do khoá/);
  assert.match(view.lockReasonError("ngắn"), /ít nhất 10/);
  assert.match(view.lockReasonError("x".repeat(501)), /tối đa 500/);
  assert.equal(view.lockReasonError("Vi phạm lặp lại: nộp quá nhanh."), null);
  assert.match(view.selfActionBlock("a", "a", "lock"), /không thể tự khoá/);
  assert.match(view.selfActionBlock("a", "a", "role"), /tự đổi vai trò/);
  assert.equal(view.selfActionBlock("a", "b", "lock"), null);
  assert.equal(view.selfActionBlock("a", null, "lock"), null);
});

test("list query uses only the VERIFIED params", () => {
  assert.equal(service.adminUsersSearch({}), "page=1&limit=20");
  assert.equal(
    service.adminUsersSearch({ page: 2, search: "  #7F3A ", status: "LOCKED" }),
    "page=2&limit=20&search=%237F3A&status=LOCKED",
  );
});

test("users service (VERIFIED routes, ASSUMED extensions optional)", async (t) => {
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

  await t.test("parses the plain backend payload", async () => {
    installFetch(() =>
      jsonResponse(200, {
        data: { items: [verifiedUser], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } },
        error: null,
        meta: {},
      }),
    );
    const page = await service.listAdminUsers({ search: "khang" });
    assert.equal(page.items[0].email, "khang.do@gmail.com");
    assert.equal(page.items[0].balance, undefined);
    assert.equal(calls[0].url, "/api/admin/users?page=1&limit=20&search=khang");
  });

  await t.test("locks with CSRF and the ASSUMED reason; unlock sends status only", async () => {
    installFetch(() => jsonResponse(200, { data: { user: { ...verifiedUser, status: "LOCKED" } }, error: null, meta: {} }));
    const user = await service.updateAdminUserStatus(KHANG, "LOCKED", "  Vi phạm lặp lại  ");
    assert.equal(user.status, "LOCKED");
    const call = calls.find((c) => c.url === `/api/admin/users/${KHANG}/status`);
    assert.equal(call.init.method, "PATCH");
    assert.equal(call.init.body, JSON.stringify({ status: "LOCKED", reason: "Vi phạm lặp lại" }));
    assert.equal(call.init.headers["X-CSRF-Token"], "csrf-token");

    installFetch(() => jsonResponse(200, { data: { user: verifiedUser }, error: null, meta: {} }));
    await service.updateAdminUserStatus(KHANG, "ACTIVE");
    const unlock = calls.find((c) => c.url === `/api/admin/users/${KHANG}/status`);
    assert.equal(unlock.init.body, JSON.stringify({ status: "ACTIVE" }));
  });

  await t.test("maps backend refusals to Vietnamese copy", async () => {
    installFetch(() =>
      jsonResponse(400, { data: null, error: { code: "CANNOT_LOCK_SELF", message: "no" }, meta: {} }),
    );
    await assert.rejects(service.updateAdminUserStatus(KHANG, "LOCKED", "reason text"), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(messages.userActionErrorMessage(error, "lock"), "Admin không thể tự khoá tài khoản của mình.");
      return true;
    });
  });
});

test("users messages", () => {
  const network = new ApiError({ kind: "network", message: "x" });
  assert.match(messages.usersLoadErrorMessage(network), /Không kết nối/);
  const notFound = new ApiError({ kind: "http", status: 404, code: "USER_NOT_FOUND", message: "x" });
  assert.match(messages.userDetailErrorMessage(notFound), /Không tìm thấy/);
  const lastAdmin = new ApiError({ kind: "http", status: 400, code: "CANNOT_DEMOTE_LAST_ADMIN", message: "x" });
  assert.match(messages.userActionErrorMessage(lastAdmin, "role"), /Admin duy nhất/);
  assert.equal(messages.userActionErrorMessage(new Error("x"), "unlock"), "Chưa mở khoá được tài khoản. Vui lòng thử lại.");
});
