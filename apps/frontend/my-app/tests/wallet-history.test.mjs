import test from "node:test";
import assert from "node:assert/strict";

const history = await import("../lib/wallet/wallet-history.ts");
const { walletTransactionSchema, walletViewSchema } = await import("../lib/wallet/wallet-service.ts");
const rules = await import("../mocks/data/economy-rules.ts");

const USER = "11111111-1111-4111-8111-111111111111";
let counter = 0;
function uuid() {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

function entry(journalId, accountClass, amount, key, extra = {}) {
  return {
    id: uuid(),
    journalId,
    amount,
    accountClass,
    description: extra.description ?? null,
    idempotencyKey: key,
    createdAt: extra.createdAt ?? "2026-09-26T08:10:00.000Z",
    reversesJournalId: extra.reversesJournalId ?? null,
  };
}

const NOW = new Date("2026-09-26T08:10:00.000Z");

test("wallet history rows (Figma 7)", async (t) => {
  await t.test("groups a two-entry journal into one row and keeps the API order", () => {
    const unlock = uuid();
    const grant = uuid();
    const rows = history.toHistoryRows(
      [
        entry(unlock, "FROZEN", -100, `starter-unlock:${USER}`),
        entry(unlock, "USER_AVAILABLE", 100, `starter-unlock:${USER}`),
        entry(grant, "FROZEN", 100, `starter-grant:${USER}`),
      ],
      NOW,
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => [row.title, row.amount, row.bucket, row.direction]),
      [
        ["Mở khoá điểm khởi đầu", 100, "USER_AVAILABLE", "in"],
        ["Điểm khởi đầu", 100, "FROZEN", "in"],
      ],
    );
    assert.equal(rows[0].note, "Đóng băng → Khả dụng sau khảo sát đầu tiên");
    assert.equal(rows[0].shortNote, "Đóng băng → Khả dụng");
    assert.equal(rows[1].note, "Tài khoản mới");
  });

  await t.test("pending Google Forms reward counts down the 48h review", () => {
    const journal = uuid();
    const createdAt = new Date(NOW.getTime() - 17 * 3_600_000).toISOString();
    const [row] = history.toHistoryRows(
      [
        entry(journal, "PENDING", 18, "external-completion:attempt-1", {
          createdAt,
        }),
      ],
      NOW,
    );
    assert.equal(row.title, "Thưởng khảo sát");
    assert.equal(row.note, "Khảo sát");
    assert.equal(row.pendingHoursLeft, 31);
    assert.equal(history.statusLabel(row), "Chờ duyệt · còn 31 giờ");
    assert.equal(history.nextPendingReleaseHours([row]), 31);
  });

  await t.test("a released pending reward no longer counts down", () => {
    const credit = uuid();
    const release = uuid();
    const rows = history.toHistoryRows(
      [
        entry(release, "PENDING", -18, "release-pending:attempt-1"),
        entry(release, "USER_AVAILABLE", 18, "release-pending:attempt-1"),
        entry(credit, "PENDING", 18, "external-completion:attempt-1"),
      ],
      NOW,
    );
    assert.equal(rows[0].kind, "REWARD_RELEASE");
    assert.equal(rows[0].bucket, "USER_AVAILABLE");
    assert.equal(rows[1].pendingHoursLeft, null);
    assert.equal(history.statusLabel(rows[1]), "Khả dụng", "the original credit no longer reads Chờ duyệt");
    assert.equal(history.nextPendingReleaseHours(rows), null);
  });

  await t.test("survey escrow is spending into Ký quỹ; the title comes from the description", () => {
    const journal = uuid();
    const [row] = history.toHistoryRows(
      [
        entry(journal, "USER_AVAILABLE", -60, "publish:form-version-1", {
          description: "Escrow lock for survey publish: Khảo sát thói quen đọc sách",
        }),
        entry(journal, "ESCROW", 60, "publish:form-version-1", {
          description: "Escrow lock for survey publish: Khảo sát thói quen đọc sách",
        }),
      ],
      NOW,
    );
    assert.equal(row.direction, "out");
    assert.equal(row.amount, -60);
    assert.equal(row.bucket, "ESCROW");
    assert.equal(row.note, "Khảo sát thói quen đọc sách");
    assert.equal(history.formatSignedPoints(row.amount), "−60");
  });

  await t.test("escrow refund strips the unused-slots suffix", () => {
    const journal = uuid();
    const [row] = history.toHistoryRows(
      [entry(journal, "USER_AVAILABLE", 20, "close-refund:form-1:1", { description: "Escrow refund on survey close: Khảo sát A (2 unused slots)" })],
      NOW,
    );
    assert.equal(row.kind, "ESCROW_REFUND");
    assert.equal(row.note, "Khảo sát A");
  });

  await t.test("top-up rows show the transfer reference; reversals follow the entry sign", () => {
    const topUp = uuid();
    const reversal = uuid();
    const rows = history.toHistoryRows(
      [
        entry(reversal, "USER_AVAILABLE", -12, "reversal:x", { reversesJournalId: topUp }),
        entry(topUp, "USER_AVAILABLE", 100, `topup-approval:${topUp}`, {
          description: "Manual top-up approval: RESCOMK7Q2M9XA (100 points)",
        }),
      ],
      NOW,
    );
    assert.equal(rows[0].kind, "REVERSAL");
    assert.equal(rows[0].direction, "out");
    assert.equal(rows[1].kind, "TOP_UP");
    assert.equal(rows[1].note, "Chuyển khoản RESCOMK7Q2M9XA");
    // `topup-approval:` stays the manual kind (not TOP_UP_PAYOS) after the PayOS prefixes were added.
    assert.notEqual(rows[1].kind, "TOP_UP_PAYOS");
    assert.equal(rows[1].title, history.toHistoryRows([entry(topUp, "USER_AVAILABLE", 100, `topup-approval:${topUp}`)], NOW)[0].title);
  });

  await t.test("PayOS top-up credit and mismatch credit have correct titles and appear in top-up filter", () => {
    const payosCredit = uuid();
    const mismatchCredit = uuid();
    const rows = history.toHistoryRows(
      [
        entry(payosCredit, "USER_AVAILABLE", 50, "topup-credit:1001", {
          description: "PayOS top-up credit: order 1001 (50 points)",
        }),
        entry(mismatchCredit, "USER_AVAILABLE", 45, "topup-mismatch:1002", {
          description: "PayOS mismatch adjustment credit: order 1002 (45 points)",
        }),
      ],
      NOW,
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, "TOP_UP_PAYOS");
    assert.equal(rows[0].title, "Nạp Điểm qua PayOS");
    assert.equal(rows[0].amount, 50);

    assert.equal(rows[1].kind, "TOP_UP_MISMATCH");
    assert.equal(rows[1].title, "Nạp Điểm (đã điều chỉnh theo số thực nhận)");
    assert.equal(rows[1].amount, 45);

    const filtered = history.filterHistory(rows, "top-up");
    assert.equal(filtered.length, 2);
  });


  await t.test("voucher redemption journal shows Đổi voucher and outgoing points", () => {
    const journal = uuid();
    const [row] = history.toHistoryRows(
      [entry(journal, "USER_AVAILABLE", -150, "redemption:redeem-key-1", {
        description: "Voucher redemption: Voucher mua đồ uống",
      })],
      NOW,
    );
    assert.equal(row.kind, "VOUCHER_REDEMPTION");
    assert.equal(row.title, "Đổi voucher");
    assert.equal(row.direction, "out");
    assert.equal(row.amount, -150);
    assert.equal(row.note, "Voucher mua đồ uống");
  });

  await t.test("filters Tất cả / Nhận / Chi / Nạp", () => {
    const rows = [
      { id: "1", kind: "SURVEY_REWARD", direction: "in" },
      { id: "2", kind: "SURVEY_ESCROW", direction: "out" },
      { id: "3", kind: "TOP_UP", direction: "in" },
    ];
    const ids = (filter) => history.filterHistory(rows, filter).map((row) => row.id);
    assert.deepEqual(ids("all"), ["1", "2", "3"]);
    assert.deepEqual(ids("in"), ["1", "3"]);
    assert.deepEqual(ids("out"), ["2"]);
    assert.deepEqual(ids("top-up"), ["3"]);
  });

  await t.test("unknown keys fall back to a generic row", () => {
    assert.equal(history.historyKindOf("something-new:1", null), "OTHER");
    assert.equal(history.bucketPresentation("USER_AVAILABLE").label, "Khả dụng");
  });
});

test("wallet history: direction follows the caller's own entries", async (t) => {
  await t.test("a publisher's survey payout (only their Ký quỹ entry) is spending", () => {
    for (const key of ["internal-reward:response-1", "external-completion:attempt-9", "integrity-hold:response-2"]) {
      const [row] = history.toHistoryRows(
        [entry(uuid(), "ESCROW", -12, key, { description: "Survey reward credit: response-1" })],
        NOW,
      );
      assert.equal(row.direction, "out", key);
      assert.equal(row.amount, -12, key);
      assert.equal(row.title, "Trả thưởng khảo sát", key);
      assert.equal(row.note, "Khảo sát của bạn", key);
      assert.equal(row.bucket, "ESCROW", key);
      assert.equal(row.pendingHoursLeft, null, key);
      assert.equal(row.pendingDue, false, key);
      assert.equal(history.formatRowPoints(row), "−12", key);
    }
    // No survey title: the payout never shows the response id of the description.
    const [row] = history.toHistoryRows(
      [entry(uuid(), "ESCROW", -12, "internal-reward:r", { description: "Survey reward credit: r" })],
      NOW,
    );
    assert.equal(row.note, "Khảo sát của bạn");
  });

  await t.test("the respondent's side of the same reward stays income", () => {
    const [row] = history.toHistoryRows([entry(uuid(), "USER_AVAILABLE", 12, "internal-reward:response-1")], NOW);
    assert.equal(row.direction, "in");
    assert.equal(row.title, "Thưởng khảo sát");
  });

  await t.test("refund hold and withdrawal (Story 13.10): titles, direction out of / back into Khả dụng", () => {
    const hold = uuid();
    const withdraw = uuid();
    const resolve = uuid();
    const rows = history.toHistoryRows(
      [
        entry(hold, "USER_AVAILABLE", -120, "topup-refund-hold:r-1"),
        entry(hold, "REFUND_HOLD", 120, "topup-refund-hold:r-1"),
        entry(withdraw, "USER_AVAILABLE", 120, "topup-refund-withdraw:r-1"),
        entry(withdraw, "REFUND_HOLD", -120, "topup-refund-withdraw:r-1"),
        entry(resolve, "REFUND_HOLD", -120, "topup-refund-resolve:r-2", {
          description: "Top-up refund: order 12345 · top-up req-2",
        }),
      ],
      NOW,
    );
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((row) => [row.kind, row.title, row.amount, row.bucket, row.direction]),
      [
        ["TOP_UP_REFUND_HOLD", "Giữ chờ hoàn tiền", -120, "REFUND_HOLD", "out"],
        ["TOP_UP_REFUND_RELEASE", "Hoàn lại từ giữ chờ hoàn tiền", 120, "USER_AVAILABLE", "in"],
        ["TOP_UP_REFUND", "Hoàn tiền nạp Điểm", -120, "REFUND_HOLD", "out"],
      ],
    );
    assert.equal(rows[2].note, "Hoàn tiền đơn #12345");
  });

  await t.test("dispute refund: taken from the respondent, returned to the publisher", () => {
    const [respondent] = history.toHistoryRows(
      [entry(uuid(), "INTEGRITY_HOLD", -18, "dispute-resolution:case-1:refund")],
      NOW,
    );
    assert.equal(respondent.direction, "out");
    assert.equal(respondent.amount, -18);
    assert.equal(respondent.title, "Thu hồi sau khiếu nại");
    assert.equal(history.rowPresentation(respondent).label, "Đã thu hồi");
    assert.deepEqual(history.filterHistory([respondent], "in"), []);

    const [publisher] = history.toHistoryRows(
      [entry(uuid(), "USER_AVAILABLE", 18, "dispute-resolution:case-1:refund")],
      NOW,
    );
    assert.equal(publisher.direction, "in");
    assert.equal(publisher.title, "Hoàn điểm khiếu nại");
  });

  await t.test("dispute release: Đang giữ → Khả dụng is income", () => {
    const journal = uuid();
    const [row] = history.toHistoryRows(
      [
        entry(journal, "INTEGRITY_HOLD", -18, "dispute-resolution:case-1:release"),
        entry(journal, "USER_AVAILABLE", 18, "dispute-resolution:case-1:release"),
      ],
      NOW,
    );
    assert.equal(row.direction, "in");
    assert.equal(row.amount, 18);
    assert.equal(row.title, "Trả điểm sau khiếu nại");
    assert.equal(row.bucket, "USER_AVAILABLE");
  });
});

test("wallet history: 48h review states", async (t) => {
  const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

  await t.test("past 48h without a release journal: Sắp vào Khả dụng, no countdown", () => {
    const [row] = history.toHistoryRows(
      [entry(uuid(), "PENDING", 18, "external-completion:attempt-2", { createdAt: hoursAgo(49) })],
      NOW,
    );
    assert.equal(row.pendingHoursLeft, null);
    assert.equal(row.pendingDue, true);
    assert.equal(history.statusLabel(row), "Sắp vào Khả dụng");
    assert.equal(history.rowPresentation(row).label, "Sắp vào Khả dụng");
    assert.equal(history.hasDuePendingRelease([row]), true);
    assert.equal(history.nextPendingReleaseHours([row]), null);
  });

  await t.test("a credit under a dispute hold neither counts down nor matures; the hold is neutral", () => {
    const hold = uuid();
    const credit = uuid();
    const description = "Dispute hold placed for external attempt: attempt-3 (Case case-7)";
    const rows = history.toHistoryRows(
      [
        entry(hold, "PENDING", -18, "external-dispute:case-7", { description }),
        entry(hold, "INTEGRITY_HOLD", 18, "external-dispute:case-7", { description }),
        entry(credit, "PENDING", 18, "external-completion:attempt-3", { createdAt: hoursAgo(17) }),
        entry(uuid(), "PENDING", 18, "external-completion:attempt-4", { createdAt: hoursAgo(60) }),
      ],
      NOW,
    );
    const [holdRow, creditRow] = rows;
    assert.equal(holdRow.direction, "neutral");
    assert.equal(holdRow.amount, 18);
    assert.equal(history.formatRowPoints(holdRow), "18");
    assert.equal(history.statusLabel(holdRow), "Đang giữ để xét");
    assert.deepEqual(history.filterHistory([holdRow], "in"), []);
    assert.deepEqual(history.filterHistory([holdRow], "out"), []);
    assert.equal(history.filterHistory([holdRow], "all").length, 1);
    assert.equal(creditRow.pendingHoursLeft, null);
    assert.equal(creditRow.pendingDue, false);
    assert.equal(history.statusLabel(creditRow), "Chờ duyệt");
    // Another attempt is unaffected.
    assert.equal(rows[2].pendingDue, true);
  });

  await t.test("a reversed credit does not count down", () => {
    const credit = uuid();
    const rows = history.toHistoryRows(
      [
        entry(uuid(), "PENDING", -18, "reversal:credit", { reversesJournalId: credit }),
        entry(credit, "PENDING", 18, "external-completion:attempt-5", { createdAt: hoursAgo(10) }),
      ],
      NOW,
    );
    assert.equal(rows[1].pendingHoursLeft, null);
    assert.equal(rows[1].pendingDue, false);
  });
});

test("wallet history: paging helpers and point format", () => {
  const a = uuid();
  const b = uuid();
  const page = [
    entry(a, "USER_AVAILABLE", 5, "topup-approval:a"),
    entry(b, "FROZEN", -100, `starter-unlock:${USER}`),
  ];
  // A full page may end inside a journal: its entries wait for the next page.
  assert.deepEqual(
    history.dropTrailingJournal(page, true).map((item) => item.journalId),
    [a],
  );
  assert.equal(history.dropTrailingJournal(page, false).length, 2);
  const next = [page[1], entry(b, "USER_AVAILABLE", 100, `starter-unlock:${USER}`)];
  const merged = history.appendTransactions(page, next);
  assert.equal(merged.length, 3, "the shifted duplicate is skipped");
  const rows = history.toHistoryRows(merged, NOW);
  assert.equal(rows[1].title, "Mở khoá điểm khởi đầu");
  assert.equal(rows[1].amount, 100);

  assert.equal(history.formatSignedPoints(-1000), "−1.000");
  assert.equal(history.formatSignedPoints(12500), "+12.500");
});

test("mock ledger (MSW) is backend-shaped: the release is its own journal", () => {
  const start = Date.parse("2026-09-27T10:00:00.000Z");
  let id = 0;
  const context = (now) => ({ now, newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` });
  const state = {
    wallet: { available: 0, pending: 0, escrow: 0, frozen: 100, integrityHold: 0 },
    rows: [
      {
        id: "00000000-0000-4000-8000-000000000900",
        kind: "STARTER_GRANT",
        amount: 100,
        status: "FROZEN",
        note: "Tài khoản mới",
        surveyId: null,
        attemptId: null,
        createdAt: "2026-09-20T00:00:00.000Z",
        releasesAt: null,
      },
    ],
  };
  const reward = { amount: 18, pending: true, surveyId: "s-ext", attemptId: "a-ext", title: "Google Form" };
  rules.creditReward(state, context(start), reward);

  const before = rules.ledgerItemsFromRows(USER, state.rows);
  assert.deepEqual(
    before.map((item) => [item.idempotencyKey, item.accountClass, item.amount]),
    [
      ["external-completion:a-ext", "PENDING", 18],
      [`starter-grant:${USER}`, "FROZEN", 100],
    ],
  );

  rules.releaseDueRewards(state, context(start + rules.PENDING_REVIEW_MS));
  const after = rules.ledgerItemsFromRows(USER, state.rows);
  assert.deepEqual(
    after.map((item) => [item.idempotencyKey, item.accountClass, item.amount]),
    [
      [`starter-unlock:${USER}`, "FROZEN", -100],
      [`starter-unlock:${USER}`, "USER_AVAILABLE", 100],
      ["release-pending:a-ext", "PENDING", -18],
      ["release-pending:a-ext", "USER_AVAILABLE", 18],
      // The credit keeps the shape it was posted with.
      ["external-completion:a-ext", "PENDING", 18],
      [`starter-grant:${USER}`, "FROZEN", 100],
    ],
  );
  assert.deepEqual(state.wallet, { available: 118, pending: 0, escrow: 0, frozen: 0, integrityHold: 0 });
  for (const item of after) assert.equal(walletTransactionSchema.safeParse(item).success, true, item.idempotencyKey);

  const rows = history.toHistoryRows(after, new Date(start + rules.PENDING_REVIEW_MS + 3_600_000));
  assert.deepEqual(
    rows.map((row) => [row.title, row.amount, row.bucket, row.pendingDue]),
    [
      ["Mở khoá điểm khởi đầu", 100, "USER_AVAILABLE", false],
      ["Điểm chờ duyệt đã mở", 18, "USER_AVAILABLE", false],
      // Released: the original credit reads Khả dụng, not Chờ duyệt.
      ["Thưởng khảo sát", 18, "USER_AVAILABLE", false],
      ["Điểm khởi đầu", 100, "FROZEN", false],
    ],
  );
  assert.equal(rows[2].pendingHoursLeft, null);
});

test("wallet view schema is the shared DTO: parses a verified response, rejects an inconsistent total", () => {
  const base = {
    balance: { available: 112, pending: 18, escrow: 0, frozen: 0, integrityHold: 0, total: 130 },
    accounts: [],
  };
  const item = entry(uuid(), "PENDING", 18, "external-completion:a");
  assert.equal(walletViewSchema.safeParse({ ...base, transactions: [item] }).success, true);
  assert.equal(
    walletViewSchema.safeParse({ ...base, balance: { ...base.balance, total: 1 }, transactions: [] }).success,
    false,
  );
});

test("Story 13.12: wallet history handles topup-refund-resolve (REFUNDED vs REJECTED release) and topUpHref", () => {
  const topUpId = "11111111-2222-4333-8444-555555555555";
  const journalRefunded = uuid();
  const journalRejected = uuid();

  // 1. REFUNDED: REFUND_HOLD is debited (-250)
  const entriesRefunded = [
    {
      id: uuid(),
      journalId: journalRefunded,
      accountClass: "REFUND_HOLD",
      amount: -250,
      idempotencyKey: "topup-refund-resolve:req-refunded",
      reversesJournalId: null,
      description: `Top-up refund: order 800001 · top-up ${topUpId}`,
      createdAt: "2026-10-16T12:00:00Z",
    },
  ];

  // 2. REJECTED: USER_AVAILABLE is credited (+250)
  const entriesRejected = [
    {
      id: uuid(),
      journalId: journalRejected,
      accountClass: "REFUND_HOLD",
      amount: -250,
      idempotencyKey: "topup-refund-resolve:req-rejected",
      reversesJournalId: null,
      description: `Top-up refund release: order 800002 · top-up ${topUpId}`,
      createdAt: "2026-10-16T13:00:00Z",
    },
    {
      id: uuid(),
      journalId: journalRejected,
      accountClass: "USER_AVAILABLE",
      amount: 250,
      idempotencyKey: "topup-refund-resolve:req-rejected",
      reversesJournalId: null,
      description: `Top-up refund release: order 800002 · top-up ${topUpId}`,
      createdAt: "2026-10-16T13:00:00Z",
    },
  ];

  assert.equal(
    history.historyKindOf("topup-refund-resolve:req-refunded", null, entriesRefunded),
    "TOP_UP_REFUND",
  );
  assert.equal(
    history.historyKindOf("topup-refund-resolve:req-rejected", null, entriesRejected),
    "TOP_UP_REFUND_RELEASE",
  );

  const rowsRefunded = history.toHistoryRows(entriesRefunded);
  assert.equal(rowsRefunded.length, 1);
  assert.equal(rowsRefunded[0].kind, "TOP_UP_REFUND");
  assert.equal(rowsRefunded[0].title, "Hoàn tiền nạp Điểm");
  assert.equal(rowsRefunded[0].direction, "out");
  assert.equal(rowsRefunded[0].amount, -250);
  assert.equal(rowsRefunded[0].topUpHref, `/wallet/top-up/${topUpId}`);

  const rowsRejected = history.toHistoryRows(entriesRejected);
  assert.equal(rowsRejected.length, 1);
  assert.equal(rowsRejected[0].kind, "TOP_UP_REFUND_RELEASE");
  assert.equal(rowsRejected[0].title, "Hoàn lại từ giữ chờ hoàn tiền");
  assert.equal(rowsRejected[0].direction, "in");
  assert.equal(rowsRejected[0].amount, 250);
  assert.equal(rowsRejected[0].topUpHref, `/wallet/top-up/${topUpId}`);

  // When description has no topUpId, topUpHref is null
  const entriesNoUuid = [
    {
      id: uuid(),
      journalId: uuid(),
      accountClass: "REFUND_HOLD",
      amount: -100,
      idempotencyKey: "topup-refund-resolve:req-no-uuid",
      reversesJournalId: null,
      description: "Top-up refund without uuid",
      createdAt: "2026-10-16T14:00:00Z",
    },
  ];
  const rowsNoUuid = history.toHistoryRows(entriesNoUuid);
  assert.equal(rowsNoUuid[0].topUpHref, null);
});

test("ADMIN_CREDIT row title, note, and reversal stays REVERSAL (Story 14.5)", () => {
  const creditJournalId = uuid();
  const entries = [
    {
      id: uuid(),
      journalId: creditJournalId,
      accountClass: "USER_AVAILABLE",
      amount: 500,
      idempotencyKey: "admin-credit:test-key-1",
      reversesJournalId: null,
      description: "Hỗ trợ khách hàng do gián đoạn dịch vụ",
      createdAt: "2026-10-19T08:00:00Z",
    },
  ];

  assert.equal(history.historyKindOf("admin-credit:test-key-1", null), "ADMIN_CREDIT");
  const rows = history.toHistoryRows(entries);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "ADMIN_CREDIT");
  assert.equal(rows[0].title, "Điểm cộng từ Admin");
  assert.equal(rows[0].amount, 500);
  assert.equal(rows[0].direction, "in");
  assert.equal(rows[0].bucket, "USER_AVAILABLE");
  assert.equal(rows[0].note, "Lý do: Hỗ trợ khách hàng do gián đoạn dịch vụ");
  assert.equal(rows[0].shortNote, "Hỗ trợ khách hàng do gián đoạn dịch vụ");

  // Reversal of an admin credit has reversesJournalId set -> kind is REVERSAL
  assert.equal(history.historyKindOf("reversal:" + creditJournalId, creditJournalId), "REVERSAL");
  const revEntries = [
    {
      id: uuid(),
      journalId: uuid(),
      accountClass: "USER_AVAILABLE",
      amount: -500,
      idempotencyKey: "reversal:" + creditJournalId,
      reversesJournalId: creditJournalId,
      description: "Hoàn tác do nhầm lẫn",
      createdAt: "2026-10-19T08:30:00Z",
    },
  ];
  const revRows = history.toHistoryRows(revEntries);
  assert.equal(revRows.length, 1);
  assert.equal(revRows[0].kind, "REVERSAL");
  assert.equal(revRows[0].title, "Điều chỉnh giao dịch");
  assert.equal(revRows[0].amount, -500);
});


