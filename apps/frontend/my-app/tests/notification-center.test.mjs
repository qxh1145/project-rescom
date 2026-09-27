import test from "node:test";
import assert from "node:assert/strict";

const { NOTIFICATION_TYPES } = await import("@rescom/schemas");
const service = await import("../lib/notifications/notification-service.ts");
const presentation = await import("../lib/notifications/notification-presentation.ts");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const dto = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "REWARD_RELEASED",
  message: "+12 điểm vào Khả dụng — Từ “Hành vi mua sắm online”.",
  isRead: false,
  createdAt: "2026-09-26T09:00:00.000Z",
  readAt: null,
};

test("Figma 14d: notification list client (VERIFIED /notifications)", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("sends the query and parses the list", async () => {
    let url;
    const list = { items: [dto], unreadCount: 1, total: 1, limit: 5, offset: 0, hasMore: false };
    globalThis.fetch = async (input) => {
      url = String(input);
      return jsonResponse({ data: list, error: null, meta: {} });
    };
    assert.deepEqual(await service.listNotifications({ limit: 5, unreadOnly: true }), list);
    assert.equal(url, "/api/notifications?limit=5&unreadOnly=true");
  });

  await t.test("keeps an unknown-type item (fallback presentation), drops structurally invalid rows", async () => {
    const unknown = { ...dto, id: "22222222-2222-4222-8222-222222222222", type: "POINTS_EARNED" };
    const broken = { ...dto, id: "not-a-uuid" };
    const noDate = { ...dto, id: "33333333-3333-4333-8333-333333333333", createdAt: "yesterday" };
    const list = { items: [unknown, broken, dto, noDate], unreadCount: 4, total: 4, limit: 20, offset: 0, hasMore: false };
    globalThis.fetch = async () => jsonResponse({ data: list, error: null, meta: {} });
    // The dropped rows still count: the badge stays authoritative.
    assert.deepEqual(await service.listNotifications(), { ...list, items: [unknown, dto] });
  });

  await t.test("sends offset for the next page", async () => {
    let url;
    const list = { items: [dto], unreadCount: 1, total: 21, limit: 20, offset: 20, hasMore: false };
    globalThis.fetch = async (input) => {
      url = String(input);
      return jsonResponse({ data: list, error: null, meta: {} });
    };
    await service.listNotifications({ limit: 20, offset: 20 });
    assert.equal(url, "/api/notifications?limit=20&offset=20");
  });

  await t.test("still rejects an invalid list envelope", async () => {
    const bad = { items: [dto], unreadCount: -1, total: 1, limit: 20, offset: 0, hasMore: false };
    globalThis.fetch = async () => jsonResponse({ data: bad, error: null, meta: {} });
    await assert.rejects(() => service.listNotifications(), (error) => error.kind === "malformed");

    globalThis.fetch = async () => jsonResponse({ data: { items: "nope" }, error: null, meta: {} });
    await assert.rejects(() => service.listNotifications(), (error) => error.kind === "malformed");
  });
});

test("Figma 14d: message split into title and body", () => {
  assert.deepEqual(service.splitNotificationMessage("Khảo sát bị từ chối — Đã hoàn 120 điểm."), {
    title: "Khảo sát bị từ chối",
    body: "Đã hoàn 120 điểm.",
  });
  assert.deepEqual(service.splitNotificationMessage("Chỉ có tiêu đề"), { title: "Chỉ có tiêu đề", body: null });
});

test("Figma 14d: presentation per type", () => {
  const { NOTIFICATION_PRESENTATION, FALLBACK_NOTIFICATION_PRESENTATION, notificationPresentation } = presentation;
  // Every shared type has its own entry, and nothing else is mapped.
  assert.deepEqual(Object.keys(NOTIFICATION_PRESENTATION).sort(), [...NOTIFICATION_TYPES].sort());
  for (const type of NOTIFICATION_TYPES) {
    assert.notEqual(notificationPresentation(type), FALLBACK_NOTIFICATION_PRESENTATION, type);
  }
  // Figma icons and tones.
  assert.deepEqual(notificationPresentation("REWARD_PENDING"), { icon: "hourglass", tone: "amber", href: "/wallet" });
  assert.deepEqual(notificationPresentation("SURVEY_REJECTED"), { icon: "x-circle", tone: "danger", href: "/forms" });
  // Unknown types (and prototype keys) render neutrally and link nowhere.
  for (const type of ["POINTS_EARNED", "toString", ""]) {
    assert.deepEqual(notificationPresentation(type), { icon: "bell", tone: "neutral", href: null });
  }
});

test("Figma 14d: title and body — mock copy keeps its split, backend copy gets a per-type title", () => {
  const { notificationText, NOTIFICATION_TITLES, FALLBACK_NOTIFICATION_TITLE } = presentation;
  // Mock / Figma copy: "Title — body", unchanged.
  assert.deepEqual(
    notificationText({ type: "REWARD_RELEASED", message: "+12 điểm vào Khả dụng — Từ “Hành vi mua sắm online”." }),
    { title: "+12 điểm vào Khả dụng", body: "Từ “Hành vi mua sắm online”." },
  );
  // Backend copy (`reward-settlement.coordinator.ts`): one sentence, no " — ".
  const earned = "18 points for your completed internal survey were added to your Available balance.";
  assert.deepEqual(notificationText({ type: "REWARD_EARNED", message: earned }), {
    title: NOTIFICATION_TITLES.REWARD_EARNED,
    body: earned,
  });
  for (const type of NOTIFICATION_TYPES) {
    assert.ok(NOTIFICATION_TITLES[type], type);
    assert.equal(notificationText({ type, message: "Plain sentence." }).body, "Plain sentence.");
  }
  assert.deepEqual(notificationText({ type: "POINTS_EARNED", message: "Hello." }), {
    title: FALLBACK_NOTIFICATION_TITLE,
    body: "Hello.",
  });
});

test("Figma 14d: WARNING is told apart by its message (top-up rejection vs starter expiry)", () => {
  const { notificationPresentation, notificationText, warningTopicOf } = presentation;
  const rejected = "Your top-up request RESCOMK7Q2M9XA for 100 points was rejected. Reason: no transfer";
  const expired =
    "Your 100 frozen starter points have expired because onboarding was not completed within 30 days of registration.";
  assert.equal(warningTopicOf(rejected), "top-up");
  assert.equal(warningTopicOf(expired), "starter-expiry");
  assert.equal(warningTopicOf("Rescom team notice about your account."), "other");

  assert.deepEqual(notificationPresentation("WARNING", rejected), { icon: "bank", tone: "danger", href: null });
  assert.equal(notificationText({ type: "WARNING", message: rejected }).title, "Yêu cầu nạp điểm chưa được duyệt");
  assert.deepEqual(notificationPresentation("WARNING", expired), { icon: "lock", tone: "danger", href: "/wallet" });
  assert.equal(notificationText({ type: "WARNING", message: expired }).title, "Điểm khởi đầu đã hết hạn");
  assert.equal(notificationPresentation("WARNING", "Something else.").icon, "alert-circle");

  // The Figma mock row renders as before.
  const mock =
    "Yêu cầu nạp điểm chưa được duyệt — Không tìm thấy giao dịch khớp nội dung RESCOM LN5820. Nếu bạn đã chuyển, hãy liên hệ hỗ trợ.";
  assert.deepEqual(notificationPresentation("WARNING", mock), { icon: "bank", tone: "danger", href: null });
  assert.equal(notificationText({ type: "WARNING", message: mock }).title, "Yêu cầu nạp điểm chưa được duyệt");
});

test("Figma 14d: time labels and HÔM NAY / TRƯỚC ĐÓ groups (Vietnam time)", () => {
  const { groupNotifications, notificationTimeLabel } = presentation;
  // 27/09 21:00 in Vietnam.
  const now = new Date("2026-09-27T14:00:00.000Z");
  assert.equal(notificationTimeLabel("2026-09-27T13:40:00.000Z", now), "20:40");
  // 00:30 on 27/09 in Vietnam is still today although it is 26/09 in UTC.
  assert.equal(notificationTimeLabel("2026-09-26T17:30:00.000Z", now), "00:30");
  assert.equal(notificationTimeLabel("2026-09-22T03:00:00.000Z", now), "22/09");
  assert.equal(notificationTimeLabel("not a date", now), "");

  const items = [
    { id: "a", createdAt: "2026-09-27T13:40:00.000Z" },
    { id: "b", createdAt: "2026-09-26T17:30:00.000Z" },
    { id: "c", createdAt: "2026-09-26T16:59:00.000Z" },
  ];
  assert.deepEqual(
    groupNotifications(items, now).map((group) => [group.label, group.items.map((item) => item.id)]),
    [
      ["HÔM NAY", ["a", "b"]],
      ["TRƯỚC ĐÓ", ["c"]],
    ],
  );
  assert.deepEqual(
    groupNotifications(items.slice(2), now).map((group) => group.key),
    ["earlier"],
  );
  assert.deepEqual(groupNotifications([], now), []);
});
