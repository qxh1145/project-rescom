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
  assert.deepEqual(view.fraudCellOf({ status: "ACTIVE" }), { text: "Chưa có", flagged: false });
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
  assert.equal(view.formatCount(undefined), "Chưa có");
  assert.equal(view.formatCount(1340), "1.340");
});

test("dates are local day/month", () => {
  const iso = new Date(2026, 8, 26, 15, 31).toISOString();
  assert.equal(view.formatDayMonth(iso), "26/09");
  assert.equal(view.formatDayMonthTime(iso), "26/09 15:31");
  assert.equal(view.formatDayMonth("nope"), "Chưa có");
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

  await t.test("locks with CSRF and the required audit reason; unlock sends status only", async () => {
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

test("point credit view helpers (Story 14.5)", () => {
  assert.deepEqual(view.parseCreditAmount(" 100 "), { amount: 100 });
  assert.deepEqual(view.parseCreditAmount("5.000"), { amount: 5000 });
  assert.deepEqual(view.parseCreditAmount("10,000"), { amount: 10000 });
  assert.deepEqual(view.parseCreditAmount(""), { error: "Nhập số Điểm cần cộng." });
  assert.deepEqual(view.parseCreditAmount("-10"), { error: "Nhập số nguyên dương." });
  assert.deepEqual(view.parseCreditAmount("abc"), { error: "Nhập số nguyên dương." });

  assert.equal(view.needsRetypeConfirm(5000), false);
  assert.equal(view.needsRetypeConfirm(5001), true);
  assert.equal(view.retypeMatches(" 5.001 ", 5001), true);
  assert.equal(view.retypeMatches("5000", 5001), false);

  assert.match(view.creditReasonError("  "), /Nhập lý do/);
  assert.match(view.creditReasonError("ngắn"), /ít nhất 10/);
  assert.match(view.creditReasonError("x".repeat(501)), /tối đa 500/);
  assert.equal(view.creditReasonError("Bồi thường lỗi gián đoạn hệ thống khảo sát."), null);
});

test("point credit service and messages (Story 14.5)", async (t) => {
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

  await t.test("creditAdminUserPoints posts with CSRF and validates response", async () => {
    installFetch(() =>
      jsonResponse(200, {
        data: {
          journalId: "22222222-2222-4222-8222-222222222222",
          userId: KHANG,
          amount: 500,
          reason: "Bồi thường sự cố",
          createdAt: "2026-10-19T08:00:00Z",
          replayed: false,
        },
        error: null,
        meta: {},
      }),
    );
    const result = await service.creditAdminUserPoints(KHANG, {
      amount: 500,
      reason: "Bồi thường sự cố",
      idempotencyKey: "credit-key-1",
    });
    assert.equal(result.amount, 500);
    assert.equal(result.replayed, false);
    const call = calls.find((c) => c.url === `/api/admin/users/${KHANG}/point-credits`);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["X-CSRF-Token"], "csrf-token");
  });

  await t.test("listAdminUserPointCredits fetches credit list", async () => {
    installFetch(() =>
      jsonResponse(200, {
        data: {
          items: [
            {
              journalId: "22222222-2222-4222-8222-222222222222",
              amount: 500,
              reason: "Bồi thường sự cố",
              createdAt: "2026-10-19T08:00:00Z",
              reversed: false,
              reversalJournalId: null,
              reversedAt: null,
            },
          ],
        },
        error: null,
        meta: {},
      }),
    );
    const list = await service.listAdminUserPointCredits(KHANG);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].amount, 500);
  });

  await t.test("reverseAdminPointCredit posts reversal with reason", async () => {
    const journalId = "22222222-2222-4222-8222-222222222222";
    installFetch(() =>
      jsonResponse(200, {
        data: {
          id: "33333333-3333-4333-8333-333333333333",
          idempotencyKey: `reversal:${journalId}`,
          description: "Hoàn tác do nhầm lẫn",
          reversesJournalId: journalId,
          createdAt: "2026-10-19T08:30:00Z",
          entries: [],
        },
        error: null,
        meta: {},
      }),
    );
    const journal = await service.reverseAdminPointCredit(journalId, "Hoàn tác do nhầm lẫn");
    assert.equal(journal.reversesJournalId, journalId);
    const call = calls.find((c) => c.url === `/api/economy/journals/${journalId}/reverse`);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.body, JSON.stringify({ reason: "Hoàn tác do nhầm lẫn" }));
  });

  await t.test("maps credit and reverse errors to messages", () => {
    const selfCredit = new ApiError({ kind: "http", status: 403, code: "ADMIN_SELF_CREDIT_FORBIDDEN", message: "x" });
    assert.equal(messages.userActionErrorMessage(selfCredit, "credit"), "Bạn không thể tự cộng Điểm cho tài khoản của mình.");

    const banned = new ApiError({ kind: "http", status: 409, code: "USER_BANNED", message: "x" });
    assert.equal(messages.userActionErrorMessage(banned, "credit"), "Tài khoản này đang bị khoá nên không thể cộng Điểm.");

    const insufficient = new ApiError({ kind: "http", status: 409, code: "INSUFFICIENT_BALANCE", message: "x" });
    assert.equal(messages.userActionErrorMessage(insufficient, "reverse"), "Người dùng đã dùng một phần số Điểm này nên không thể hoàn tác.");

    const reversed = new ApiError({ kind: "http", status: 409, code: "JOURNAL_ALREADY_REVERSED", message: "x" });
    assert.equal(messages.userActionErrorMessage(reversed, "reverse"), "Khoản cộng Điểm này đã được hoàn tác.");
  });
});

