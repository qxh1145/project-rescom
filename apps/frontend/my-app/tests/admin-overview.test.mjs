import test from "node:test";
import assert from "node:assert/strict";

const view = await import("../lib/admin/overview-view.ts");
const service = await import("../lib/admin/overview-service.ts");
const messages = await import("../lib/admin/overview-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

const NOW = new Date("2026-09-26T14:00:00.000Z"); // 21:00 Thứ Bảy in Vietnam
const hours = (n) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

/** Figma 11 "Tổng quan" (62:4070) sample. */
const overview = {
  pendingSurveys: { count: 3 },
  pendingTopUps: { count: 2, points: 300, amountVnd: 60000 },
  openIssues: { disputes: 1, missingCodeReports: 1 },
  escrow: { points: 12345, runningSurveys: 5 },
  todo: [
    {
      kind: "MISSING_CODE",
      id: "d15b0a7e-7f3a-4c1e-9a55-000000000004",
      createdAt: hours(-0.5),
      moreCount: 0,
      priority: false,
      surveyTitle: "Thói quen dùng AI trong học tập của sinh viên IT",
      reporterRole: "RESPONDENT",
    },
    {
      kind: "TOP_UP",
      id: "d15b0a7e-7f3a-4c1e-9a55-000000000003",
      createdAt: hours(-1),
      moreCount: 1,
      priority: false,
      points: 200,
      amountVnd: 40000,
      requesterName: "Trần Minh",
      transferReference: "RESCOM MT4402",
    },
    {
      kind: "DISPUTE",
      id: "d15b0a7e-7f3a-4c1e-9a55-000000000001",
      createdAt: hours(-20),
      moreCount: 0,
      priority: true,
      attemptRef: "7F3A",
      respondentName: "Linh N.",
      surveyTitle: "Thói quen đọc sách của sinh viên",
      pendingReleasesAt: hours(31),
    },
    {
      kind: "SURVEY_REVIEW",
      id: "d15b0a7e-7f3a-4c1e-9a55-000000000002",
      createdAt: "2026-09-26T12:30:00.000Z",
      moreCount: 2,
      priority: false,
      surveyTitle: "Hành vi tiêu dùng của sinh viên Marketing",
      publisherName: "Linh N.",
      surveyType: "EXTERNAL",
    },
  ],
  flaggedAccounts: [
    {
      userId: "f7a3b1c2-7f3a-4d5e-8a90-00000000007f",
      reference: "7F3A",
      violationCount: 5,
      windowDays: 14,
      types: ["TIME_BARRIER", "COMPLETION_CODE", "TIME_BARRIER"],
      repeated: true,
    },
    {
      userId: "f7a3b1c2-a901-4d5e-8a90-0000000000a9",
      reference: "A901",
      violationCount: 2,
      windowDays: 14,
      types: ["RATE_LIMIT"],
      repeated: false,
    },
  ],
};

test("admin overview view (Figma 62:4070)", async (t) => {
  await t.test("header date is the Vietnamese calendar day with its weekday", () => {
    assert.equal(view.formatAdminToday(NOW), "Thứ Bảy, 26/09/2026");
    // 18:00 UTC Saturday is already Sunday in Vietnam.
    assert.equal(view.formatAdminToday(new Date("2026-09-26T18:00:00.000Z")), "Chủ Nhật, 27/09/2026");
  });

  await t.test("stat cards carry Figma's captions and links", () => {
    const cards = view.statCardsOf(overview);
    assert.deepEqual(
      cards.map((card) => [card.label, card.value, card.caption, card.href]),
      [
        ["Khảo sát chờ duyệt", "3", "Mở hàng chờ →", "/admin/surveys"],
        ["Yêu cầu nạp điểm chờ", "2", "300 điểm · 60.000đ", "/admin/top-ups"],
        ["Khiếu nại & báo lỗi mở", "2", "1 khiếu nại · 1 báo thiếu mã", "/admin/disputes"],
        ["Điểm đang ký quỹ", "12.345", "Trên các khảo sát đang chạy", "/admin/transactions"],
      ],
    );
    assert.equal(cards[2].valueTone, "danger");
    const quiet = view.statCardsOf({ ...overview, openIssues: { disputes: 0, missingCodeReports: 0 } });
    assert.equal(quiet[2].valueTone, "ink");
  });

  await t.test("to-do rows: oldest first, Figma titles, trailing notes and section links", () => {
    const rows = view.todoRowsOf(overview.todo, NOW);
    assert.deepEqual(
      rows.map((row) => [row.icon, row.title, row.subtitle, row.trailing?.text ?? null, row.href]),
      [
        [
          "flag",
          "Khiếu nại lượt làm #7F3A",
          "Linh N. · Thói quen đọc sách của sinh viên · điểm còn chờ 31 giờ",
          "Ưu tiên",
          "/admin/disputes?id=d15b0a7e-7f3a-4c1e-9a55-000000000001",
        ],
        [
          "file-text",
          "Duyệt: Hành vi tiêu dùng của sinh viên Marketing",
          "Linh N. · Google Forms · gửi 26/09 19:30",
          "+2 khảo sát khác",
          "/admin/surveys?id=d15b0a7e-7f3a-4c1e-9a55-000000000002",
        ],
        [
          "wallet",
          "Nạp 200 điểm · Trần Minh",
          "40.000đ · nội dung CK RESCOM MT4402",
          "+1 yêu cầu",
          "/admin/top-ups?id=d15b0a7e-7f3a-4c1e-9a55-000000000003",
        ],
        [
          "alert-circle",
          "Báo thiếu mã hoàn thành",
          "Người trả lời báo · Thói quen dùng AI trong học tập của sinh viên IT",
          null,
          "/admin/disputes?id=d15b0a7e-7f3a-4c1e-9a55-000000000004",
        ],
      ],
    );
    assert.equal(rows[0].trailing.tone, "danger");
    assert.equal(rows[1].trailing.tone, "muted");
  });

  await t.test("pending wait: whole hours left, past due, unknown", () => {
    assert.equal(view.pendingWaitText(hours(30.2), NOW), "điểm còn chờ 31 giờ");
    assert.equal(view.pendingWaitText(hours(-1), NOW), "đã hết 48 giờ chờ");
    assert.equal(view.pendingWaitText(null, NOW), null);
  });

  await t.test("flagged accounts: deduplicated reasons, Lặp lại flag, FraudLog link", () => {
    const [first, second] = overview.flaggedAccounts.map(view.flaggedAccountOf);
    assert.equal(first.title, "Người dùng #7F3A");
    assert.equal(first.subtitle, "5 lần trong 14 ngày · nộp quá nhanh, sai mã");
    assert.equal(first.repeated, true);
    assert.equal(first.href, "/admin/fraud-log?userId=f7a3b1c2-7f3a-4d5e-8a90-00000000007f");
    assert.equal(second.subtitle, "2 lần trong 14 ngày · vượt giới hạn tần suất");
    assert.equal(view.fraudTypeLabel("SOMETHING_NEW"), "hành vi bất thường");
  });
});

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("admin overview service (ASSUMED GET /admin/overview)", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("reads and validates the aggregate", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse(200, { data: overview, error: null, meta: {} });
    };
    const result = await service.getAdminOverview();
    assert.equal(calls[0], "/api/admin/overview");
    assert.equal(result.todo.length, 4);
  });

  await t.test("a malformed payload is rejected", async () => {
    globalThis.fetch = async () =>
      jsonResponse(200, { data: { ...overview, escrow: { points: -1, runningSurveys: 0 } }, error: null, meta: {} });
    await assert.rejects(service.getAdminOverview(), (error) => error.kind === "malformed");
  });

  await t.test("error copy", () => {
    assert.match(messages.overviewLoadErrorMessage(new ApiError({ kind: "network", message: "x" })), /Không kết nối/);
    assert.match(
      messages.overviewLoadErrorMessage(new ApiError({ kind: "http", status: 403, message: "x" })),
      /không có quyền quản trị/,
    );
    assert.match(messages.overviewLoadErrorMessage(new Error("x")), /Không tải được số liệu/);
  });
});
