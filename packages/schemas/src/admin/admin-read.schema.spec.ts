import {
  ADMIN_LEDGER_FILTER_KEY_PREFIXES,
  adminJournalListSchema,
  adminLedgerSummarySchema,
  listAdminJournalsQuerySchema,
  vietnamStartOfDay,
} from "./admin-ledger.schema";
import { adminOverviewSchema, adminQueueCountsSchema } from "./admin-overview.schema";
import {
  fraudLogKindOf,
  fraudLogPageSchema,
  FRAUD_LOG_SCAN_CAP,
  listFraudLogQuerySchema,
  shortCodePrefixOf,
  WRONG_COMPLETION_CODE_ACTION,
} from "./fraud-log.schema";
import { keysetCursorOf, parseKeysetCursor } from "./keyset-cursor";

const ID = "3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a01";
const USER = "7f3a0c52-8d14-4e6b-9a21-3c5d7e9f1b01";
const AT = "2026-09-26T13:40:00.000Z";

describe("keyset cursor", () => {
  it("round-trips <createdAt>:<id> and splits at the last colon", () => {
    const cursor = keysetCursorOf({ createdAt: new Date(AT), id: ID });
    expect(cursor).toBe(`${AT}:${ID}`);
    expect(parseKeysetCursor(cursor)).toEqual({ createdAt: AT, id: ID });
  });

  it("rejects malformed cursors", () => {
    for (const bad of ["", ":", `${AT}:`, `:${ID}`, `yesterday:${ID}`, `${AT}:not-a-uuid`, ID]) {
      expect(parseKeysetCursor(bad)).toBeNull();
    }
  });
});

describe("admin overview contracts", () => {
  const overview = {
    pendingSurveys: { count: 1 },
    pendingTopUps: { count: 1, points: 100, amountVnd: 20_000 },
    openIssues: { disputes: 0, missingCodeReports: 0 },
    escrow: { points: 300, runningSurveys: 2 },
    todo: [
      {
        kind: "SURVEY_REVIEW",
        id: ID,
        createdAt: AT,
        moreCount: 0,
        priority: false,
        surveyTitle: "Khảo sát",
        publisherName: "pub@fpt.edu.vn",
        surveyType: "EXTERNAL",
      },
      {
        kind: "TOP_UP",
        id: ID,
        createdAt: AT,
        moreCount: 2,
        priority: false,
        points: 100,
        amountVnd: 20_000,
        requesterName: "Linh",
        transferReference: "RESCOMK7Q2M9XA",
      },
    ],
    flaggedAccounts: [
      {
        userId: USER,
        reference: "7F3A",
        violationCount: 3,
        windowDays: 14,
        types: ["TIME_BARRIER", "COMPLETION_CODE"],
        repeated: true,
      },
    ],
  };

  it("accepts the backend shape and rejects extra or negative fields", () => {
    expect(adminOverviewSchema.safeParse(overview).success).toBe(true);
    expect(adminOverviewSchema.safeParse({ ...overview, extra: 1 }).success).toBe(false);
    expect(
      adminOverviewSchema.safeParse({ ...overview, escrow: { points: -1, runningSurveys: 0 } }).success,
    ).toBe(false);
    expect(adminQueueCountsSchema.safeParse({ surveys: 1, topUps: 0, disputes: 0, quality: 0 }).success).toBe(true);
    expect(adminQueueCountsSchema.safeParse({ surveys: 1, topUps: 0 }).success).toBe(false);
  });
});

describe("fraud log contracts", () => {
  it("parses the query: days to a number, known kinds, bounded limit and cursor", () => {
    expect(listFraudLogQuerySchema.parse({ days: "14", type: "COMPLETION_CODE" })).toEqual({
      days: 14,
      type: "COMPLETION_CODE",
      limit: 100,
    });
    expect(listFraudLogQuerySchema.safeParse({ days: "5" }).success).toBe(false);
    expect(listFraudLogQuerySchema.safeParse({ type: "SOMETHING" }).success).toBe(false);
    expect(listFraudLogQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(listFraudLogQuerySchema.safeParse({ cursor: "x" }).success).toBe(false);
    expect(listFraudLogQuerySchema.safeParse({ search: "   " }).success).toBe(false);
    expect(listFraudLogQuerySchema.safeParse({ page: "1" }).success).toBe(false);
  });

  it("maps a wrong completion code to COMPLETION_CODE", () => {
    expect(fraudLogKindOf({ type: "SECURITY_VIOLATION", details: { action: WRONG_COMPLETION_CODE_ACTION } })).toBe(
      "COMPLETION_CODE",
    );
    expect(fraudLogKindOf({ type: "SECURITY_VIOLATION", details: null })).toBe("SECURITY_VIOLATION");
    expect(fraudLogKindOf({ type: "TIME_BARRIER" })).toBe("TIME_BARRIER");
  });

  it("accepts a page and requires nextCursor", () => {
    const page = {
      items: [
        {
          id: ID,
          userId: USER,
          type: "TIME_BARRIER",
          survey: { id: ID, title: "Khảo sát" },
          details: { elapsedSeconds: 40 },
          createdAt: AT,
        },
      ],
      total: 1,
      windowDays: 14,
      accounts: [{ userId: USER, count: 1, repeated: false, status: "ACTIVE" }],
      nextCursor: null,
      totalCapped: false,
      truncated: false,
    };
    expect(fraudLogPageSchema.safeParse(page).success).toBe(true);
    const { nextCursor: _omitted, ...withoutCursor } = page;
    expect(fraudLogPageSchema.safeParse(withoutCursor).success).toBe(false);
    expect(fraudLogPageSchema.safeParse({ ...page, windowDays: 9 }).success).toBe(false);
    expect(fraudLogPageSchema.safeParse({ ...page, total: FRAUD_LOG_SCAN_CAP + 1 }).success).toBe(false);
    const { truncated: _flag, ...withoutFlag } = page;
    expect(fraudLogPageSchema.safeParse(withoutFlag).success).toBe(false);
  });

  it("reads a short code only from hex terms of at least two digits", () => {
    expect(shortCodePrefixOf(" #7F3A ")).toBe("7f3a");
    expect(shortCodePrefixOf("ab")).toBe("ab");
    expect(shortCodePrefixOf("#a")).toBeNull();
    expect(shortCodePrefixOf("khang")).toBeNull();
  });
});

describe("admin ledger contracts", () => {
  it("validates the journals query", () => {
    expect(listAdminJournalsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      listAdminJournalsQuerySchema.safeParse({ type: "refund", from: AT, to: AT, before: `${AT}:${ID}` }).success,
    ).toBe(true);
    expect(listAdminJournalsQuerySchema.safeParse({ type: "payout" }).success).toBe(false);
    expect(listAdminJournalsQuerySchema.safeParse({ before: "garbage" }).success).toBe(false);
    expect(
      listAdminJournalsQuerySchema.safeParse({ from: "2026-09-27T00:00:00.000Z", to: AT }).success,
    ).toBe(false);
    expect(listAdminJournalsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("gives every prefix to exactly one segment", () => {
    const all = Object.values(ADMIN_LEDGER_FILTER_KEY_PREFIXES).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((prefix) => prefix.endsWith(":"))).toBe(true);
  });

  it("accepts the journal page and summary, strictly", () => {
    const entry = { id: ID, journalId: ID, accountId: USER, amount: 10, createdAt: AT };
    const list = {
      items: [
        {
          id: ID,
          idempotencyKey: `close-refund:${ID}:c1`,
          description: null,
          reversesJournalId: null,
          createdAt: AT,
          entries: [{ ...entry, accountClass: "USER_AVAILABLE", ownerName: null }],
          related: "Khảo sát",
          attemptId: null,
        },
      ],
      limit: 50,
      hasMore: false,
    };
    expect(adminJournalListSchema.safeParse(list).success).toBe(true);
    expect(
      adminJournalListSchema.safeParse({ ...list, items: [{ ...list.items[0], userEmail: "x" }] }).success,
    ).toBe(false);
    expect(
      adminLedgerSummarySchema.safeParse({
        pendingTopUps: { count: 0, points: 0, amountVnd: 0 },
        escrowTotal: 0,
        pendingTotal: 0,
        refundedToday: { points: 0, surveys: 0 },
      }).success,
    ).toBe(true);
  });

  it("starts the Vietnam day at 17:00 UTC of the previous day", () => {
    expect(vietnamStartOfDay(new Date("2026-09-26T18:30:00.000Z")).toISOString()).toBe("2026-09-26T17:00:00.000Z");
    expect(vietnamStartOfDay(new Date("2026-09-26T16:59:59.000Z")).toISOString()).toBe("2026-09-25T17:00:00.000Z");
  });
});
