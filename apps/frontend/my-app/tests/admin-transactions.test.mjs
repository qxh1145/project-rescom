import test from "node:test";
import assert from "node:assert/strict";

const tx = await import("../lib/admin/admin-transactions.ts");
const { adminJournalListSchema, adminLedgerSummarySchema } = await import("../lib/admin/transactions-service.ts");
const rules = await import("../mocks/data/economy-rules.ts");

const ID = "3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a01";
const USER = "11111111-1111-4111-8111-111111111111";

function journal(key, entries, extra = {}) {
  return {
    id: ID,
    idempotencyKey: key,
    description: null,
    reversesJournalId: null,
    createdAt: "2026-09-26T13:40:00.000Z",
    entries: entries.map(([accountClass, amount, ownerName = null]) => ({ accountClass, amount, ownerName })),
    ...extra,
  };
}

test("Figma rows: type, move, party, related and tone", () => {
  const refund = tx.toTransactionRow(
    journal("close-refund:x", [["ESCROW", -120, "Nguyễn Thuỳ Linh"], ["USER_AVAILABLE", 120, "Nguyễn Thuỳ Linh"]], {
      related: "Khảo sát bị từ chối",
    }),
  );
  assert.deepEqual(
    { title: refund.title, route: refund.route, related: refund.related, amount: refund.amount, tone: refund.tone },
    { title: "Hoàn ký quỹ", route: "Ký quỹ → Khả dụng · Linh N.", related: "Khảo sát bị từ chối", amount: 120, tone: "teal" },
  );

  const lock = tx.toTransactionRow(journal("publish:x", [["USER_AVAILABLE", -100, "Nguyễn Thuỳ Linh"], ["ESCROW", 100, "Nguyễn Thuỳ Linh"]]));
  assert.equal(lock.title, "Khoá ký quỹ");
  assert.equal(lock.route, "Khả dụng → Ký quỹ · Linh N.");
  assert.equal(lock.tone, "amber");

  const reward = tx.toTransactionRow(
    journal("external-completion:c21d4e8a-5b6c-4d7e-8f90-a1b2c3d4e5f6", [["PENDING", 10]]),
  );
  assert.equal(reward.title, "Thưởng khảo sát");
  assert.equal(reward.route, "Ký quỹ → Chờ 48h · #C21D"); // source implied: the publisher's escrow
  assert.equal(reward.tone, "ink");

  const reversal = tx.toTransactionRow(
    journal("dispute-resolution:case:refund", [["PENDING", -10], ["ESCROW", 10]], {
      attemptId: "7f3a9c2e-1d4b-4a6c-8e5f-0a1b2c3d4e5f",
    }),
  );
  assert.equal(reversal.title, "Đảo thưởng");
  assert.equal(reversal.route, "Chờ 48h → Ký quỹ · #7F3A");
  assert.equal(reversal.related, "Khiếu nại được chấp nhận");

  const unlock = tx.toTransactionRow(journal(`starter-unlock:${USER}`, [["FROZEN", -100, "Nguyễn Thuỳ Linh"], ["USER_AVAILABLE", 100, "Nguyễn Thuỳ Linh"]]));
  assert.equal(unlock.title, "Mở khoá điểm khởi đầu");
  assert.equal(unlock.route, "Đóng băng → Khả dụng · Linh N.");
  assert.equal(unlock.related, "Kích hoạt tài khoản");
  assert.equal(unlock.tone, "teal");
});

test("a top-up approved by an admin reads as 'Nạp điểm' from clearing to Khả dụng", () => {
  const row = {
    id: ID,
    kind: "TOP_UP",
    amount: 200,
    status: "AVAILABLE",
    note: "RESCOMMT4492QA",
    surveyId: null,
    attemptId: null,
    createdAt: "2026-09-27T01:00:00.000Z",
    releasesAt: null,
  };
  const [item] = rules.ledgerItemsFromRows(USER, [row]);
  const result = tx.toTransactionRow({
    ...item,
    id: item.journalId,
    entries: [{ amount: item.amount, accountClass: item.accountClass, ownerName: "Trần Minh" }],
  });
  assert.equal(result.title, "Nạp điểm");
  assert.equal(result.route, "Chuyển khoản → Khả dụng · Minh T.");
  assert.equal(result.related, "Chuyển khoản RESCOMMT4492QA");
  assert.equal(result.amount, 200);
  assert.equal(tx.matchesTransactionFilter(tx.journalKindOf(item), "top-up"), true);
  assert.equal(tx.matchesTransactionFilter(tx.journalKindOf(item), "refund"), false);
});

test("segments group journal kinds", () => {
  assert.equal(tx.matchesTransactionFilter("SURVEY_ESCROW", "escrow"), true);
  assert.equal(tx.matchesTransactionFilter("SURVEY_REWARD", "reward"), true);
  assert.equal(tx.matchesTransactionFilter("ESCROW_REFUND", "refund"), true);
  assert.equal(tx.matchesTransactionFilter("DISPUTE_RESOLUTION", "refund"), true);
  assert.equal(tx.matchesTransactionFilter("STARTER_UNLOCK", "reward"), false);
  assert.equal(tx.matchesTransactionFilter("STARTER_UNLOCK", "all"), true);
  assert.equal(tx.isTransactionFilter("escrow"), true);
  assert.equal(tx.isTransactionFilter("nope"), false);
});

test("periods start at 00:00 Vietnam time", () => {
  // 27/09 01:30 in Vietnam = 26/09 18:30 UTC.
  const now = new Date("2026-09-26T18:30:00.000Z");
  assert.equal(tx.periodStartIso("today", now), "2026-09-26T17:00:00.000Z");
  assert.equal(tx.periodStartIso("7d", now), "2026-09-20T17:00:00.000Z");
  assert.equal(tx.periodStartIso("30d", now), "2026-08-28T17:00:00.000Z");
  assert.equal(tx.periodStartIso("all", now), null);
});

test("names and attempt codes", () => {
  assert.equal(tx.shortPersonName("Nguyễn Thuỳ Linh"), "Linh N.");
  assert.equal(tx.shortPersonName("Trần Minh"), "Minh T.");
  assert.equal(tx.shortPersonName("Admin"), "Admin");
  assert.equal(tx.attemptCode("7f3a9c2e-1d4b-4a6c-8e5f-0a1b2c3d4e5f"), "#7F3A");
});

test("service schemas accept the verified journal shape and the ASSUMED extras", () => {
  const entry = { id: ID, journalId: ID, accountId: USER, amount: 10, createdAt: "2026-09-26T13:40:00.000Z" };
  const base = { id: ID, idempotencyKey: "publish:x", description: null, reversesJournalId: null, createdAt: entry.createdAt };
  const list = {
    items: [
      { ...base, entries: [entry] },
      { ...base, entries: [{ ...entry, accountClass: "ESCROW", ownerName: "Linh" }], related: "Khảo sát", attemptId: null },
    ],
    limit: 50,
    hasMore: false,
  };
  assert.equal(adminJournalListSchema.safeParse(list).success, true);
  const summary = {
    pendingTopUps: { count: 2, points: 300, amountVnd: 60_000 },
    escrowTotal: 0,
    pendingTotal: 18,
    refundedToday: { points: 120, surveys: 1 },
  };
  assert.equal(adminLedgerSummarySchema.safeParse(summary).success, true);
});

test("journal cursor: keyset order, parse, and no repeated rows across pages", () => {
  const a = { id: "00000000-0000-4000-8000-00000000000b", createdAt: "2026-09-26T13:40:00.000Z" };
  const b = { id: "00000000-0000-4000-8000-00000000000a", createdAt: "2026-09-26T13:40:00.000Z" };
  const c = { id: "00000000-0000-4000-8000-00000000000f", createdAt: "2026-09-26T12:00:00.000Z" };
  assert.deepEqual([c, b, a].sort(tx.compareJournalsNewestFirst), [a, b, c]);

  const cursor = tx.journalCursorOf(a);
  assert.equal(cursor, "2026-09-26T13:40:00.000Z:00000000-0000-4000-8000-00000000000b");
  assert.deepEqual(tx.parseJournalCursor(cursor), { createdAt: a.createdAt, id: a.id });
  assert.equal(tx.parseJournalCursor("nope"), null);
  assert.equal(tx.parseJournalCursor("not-a-date:abc"), null);
  assert.equal(tx.parseJournalCursor("2026-09-26T13:40:00.000Z:"), null);

  // After a: same instant with a smaller id, then older rows — never a itself or anything newer.
  const parsed = tx.parseJournalCursor(cursor);
  assert.equal(tx.isAfterJournalCursor(a, parsed), false);
  assert.equal(tx.isAfterJournalCursor(b, parsed), true);
  assert.equal(tx.isAfterJournalCursor(c, parsed), true);
  const newer = { id: "00000000-0000-4000-8000-000000000001", createdAt: "2026-09-26T14:00:00.000Z" };
  assert.equal(tx.isAfterJournalCursor(newer, parsed), false);

  // "Tải thêm" drops rows already on screen.
  assert.deepEqual(tx.newJournalRows([a, b], [b, c]), [c]);
});

test("dispute refund journal of one side: implied Đang giữ source", () => {
  const publisherSide = tx.toTransactionRow(journal("dispute-resolution:case:refund", [["USER_AVAILABLE", 10, "Trần Minh"]]));
  assert.equal(publisherSide.route, "Đang giữ → Khả dụng · Minh T.");
});
