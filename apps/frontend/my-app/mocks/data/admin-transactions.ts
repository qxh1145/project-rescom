import {
  encodeMaturedReleaseCursor,
  type LedgerAccountClass,
  type LedgerIntegrityReport,
  type MaturedReleaseSummaryDto,
  type RewardSettlementResultDto,
} from "@rescom/schemas";
import {
  compareJournalsNewestFirst,
  journalKindOf,
  matchesTransactionFilter,
  periodStartIso,
  type TransactionFilter,
} from "@/lib/admin/admin-transactions";
import type { AdminJournal, AdminLedgerSummary } from "@/lib/admin/transactions-service";
import { vietnamDateKey } from "@/lib/format/date-time";
import { loadStore } from "../legacy/store";
import { pendingTopUpSummary } from "./admin-top-ups";
import { FRAUD_SEED_USER_IDS } from "./admin-fraud-log";
import { toMockUuid } from "./auth";
import { mockEscrowTotal, transactions, wallets } from "./economy";
import { ledgerItemsFromRows } from "./economy-rules";
import { allTopUps } from "./top-up";
import { createCollection, nowIso } from "../db/store";

/**
 * Admin ledger view (Figma 11f "Giao dịch điểm", 63:1629). Journals are built
 * from every user's wallet rows with the same `ledgerItemsFromRows` mapping as
 * /wallet (so a top-up approved in 11b appears here and in the requester's
 * history), plus the five Figma rows (MOCK-ONLY display seed: they belong to
 * no mock wallet).
 */

type SeedEntry = [LedgerAccountClass, number, string | null];

interface SeedJournal {
  id: string;
  idempotencyKey: string;
  description: string;
  /** Minutes before the newest Figma row (20:40). */
  minutesBefore: number;
  entries: SeedEntry[];
  related: string | null;
  attemptId: string | null;
}

const LINH = "Nguyễn Thuỳ Linh";
const LINH_ID = toMockUuid("seed-ledger:linh");

/** Names + surveys for `demoVolumeSeed`, distinct from the five Figma rows above. */
const VOLUME_NAMES = [
  "Trần Bảo Ngọc",
  "Đặng Gia Hân",
  "Vũ Minh Tuấn",
  "Bùi Thảo Vy",
  "Ngô Đức Anh",
  "Phan Thu Hà",
  "Lý Quốc Bảo",
  "Đỗ Yến Nhi",
];
const VOLUME_SURVEYS = [
  "Thói quen dùng AI trong học tập của sinh viên IT",
  "Hành vi mua sắm online của sinh viên Đà Nẵng",
  "Nhu cầu nhà trọ gần trường",
  "Mức độ hài lòng với thư viện trường",
  "Ý định sử dụng xe điện cá nhân",
  "Khảo sát chất lượng dịch vụ ăn uống và đời sống ký túc xá",
];

/**
 * "Hôm nay" needs more than one `ADMIN_JOURNAL_PAGE_SIZE` (50) page for
 * "Tải thêm" to show up in the demo. Adds 50 further balanced journals (every
 * entry list still sums to 0, like the five Figma rows above), spread across
 * the last few hours of "today" and cycling through the four everyday
 * journal kinds with realistic Vietnamese names and survey titles.
 */
function demoVolumeSeed(): SeedJournal[] {
  const kinds: ReadonlyArray<{
    prefix: string;
    describe: (name: string, survey: string, amount: number) => string;
    related: string;
    entries: (amount: number, name: string) => SeedEntry[];
  }> = [
    {
      prefix: "topup-approval",
      describe: (name, _survey, amount) => `Manual top-up approval: ${name} (${amount} points)`,
      related: "Nạp điểm qua chuyển khoản",
      entries: (amount, name) => [
        ["SYSTEM_CLEARING", -amount, null],
        ["USER_AVAILABLE", amount, name],
      ],
    },
    {
      prefix: "publish",
      describe: (name, survey) => `Escrow lock for survey publish: ${survey}`,
      related: "",
      entries: (amount, name) => [
        ["USER_AVAILABLE", -amount, name],
        ["ESCROW", amount, name],
      ],
    },
    {
      prefix: "close-refund",
      describe: (name, survey) => `Escrow refund on survey close: ${survey}`,
      related: "Khảo sát đóng",
      entries: (amount, name) => [
        ["ESCROW", -amount, name],
        ["USER_AVAILABLE", amount, name],
      ],
    },
    {
      prefix: "external-completion",
      describe: (_name, survey) => `Pending survey reward: ${survey}`,
      related: "",
      entries: (amount) => [
        ["ESCROW", -amount, null],
        ["PENDING", amount, null],
      ],
    },
  ];

  return Array.from({ length: 50 }, (_, i) => {
    const kind = kinds[i % kinds.length];
    const name = VOLUME_NAMES[i % VOLUME_NAMES.length];
    const survey = VOLUME_SURVEYS[i % VOLUME_SURVEYS.length];
    const amount = 8 + ((i * 7) % 45); // 8..52, varied but deterministic
    const id = toMockUuid(`demo-volume-seed:${i}`);
    return {
      id,
      idempotencyKey: `${kind.prefix}:${id}`,
      description: kind.describe(name, survey, amount),
      minutesBefore: 4 + i * 5, // spread across the last ~4 hours of "today"
      entries: kind.entries(amount, name),
      related: kind.related || survey,
      attemptId: null,
    };
  });
}

const SEED: readonly SeedJournal[] = [
  {
    id: "3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a01",
    idempotencyKey: "close-refund:3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a11",
    description: "Escrow refund on survey rejection (120 unused slots)",
    minutesBefore: 0, // 20:40
    entries: [
      ["ESCROW", -120, LINH],
      ["USER_AVAILABLE", 120, LINH],
    ],
    related: "Khảo sát bị từ chối",
    attemptId: null,
  },
  {
    id: "3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a02",
    idempotencyKey: "publish:3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a12",
    description: "Escrow lock for survey publish: Hành vi tiêu dùng của sinh viên…",
    minutesBefore: 70, // 19:30
    entries: [
      ["USER_AVAILABLE", -100, LINH],
      ["ESCROW", 100, LINH],
    ],
    related: "Hành vi tiêu dùng của sinh viên…",
    attemptId: null,
  },
  {
    id: "3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a03",
    idempotencyKey: "external-completion:c21d4e8a-5b6c-4d7e-8f90-a1b2c3d4e5f6",
    description: "Pending survey reward for external completion: c21d4e8a-5b6c-4d7e-8f90-a1b2c3d4e5f6",
    minutesBefore: 178, // 17:42
    entries: [
      ["ESCROW", -10, null],
      ["PENDING", 10, null],
    ],
    related: "Thói quen đọc sách…",
    attemptId: "c21d4e8a-5b6c-4d7e-8f90-a1b2c3d4e5f6",
  },
  {
    id: "3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a04",
    idempotencyKey: "dispute-resolution:3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a14:refund",
    description: "Dispute resolution refund: 3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a14",
    minutesBefore: 309, // 15:31
    entries: [
      ["PENDING", -10, null],
      ["ESCROW", 10, null],
    ],
    related: "Khiếu nại được chấp nhận",
    attemptId: "7f3a9c2e-1d4b-4a6c-8e5f-0a1b2c3d4e5f",
  },
  {
    id: "3f6d2a10-8b1c-4e5f-9a7b-1c2d3e4f5a05",
    idempotencyKey: `starter-unlock:${LINH_ID}`,
    description: `Starter points onboarding unlock: ${LINH_ID}`,
    minutesBefore: 368, // 14:32
    entries: [
      ["FROZEN", -100, LINH],
      ["USER_AVAILABLE", 100, LINH],
    ],
    related: "Kích hoạt tài khoản",
    attemptId: null,
  },
  ...demoVolumeSeed(),
];



const MINUTE_MS = 60_000;

/**
 * When the newest Figma row happened: today 20:40 (Vietnam time) once that
 * has passed, else 10 minutes ago — so the default "Hôm nay" filter shows the
 * drawn rows. Fixed at first read (reset with `?msw-reset=1`).
 */
const seedAnchor = createCollection<number>("admin-ledger-seed-anchor", () => {
  const now = Date.now();
  const figmaToday = Date.parse(`${vietnamDateKey(new Date(now))}T20:40:00+07:00`);
  return figmaToday <= now ? figmaToday : now - 10 * MINUTE_MS;
});

/** Deterministic account id per owner + tier (the real ledger has one account per pair). */
function accountIdOf(ownerKey: string, accountClass: LedgerAccountClass): string {
  return toMockUuid(`ledger-account:${ownerKey}:${accountClass}`);
}

function seedJournals(): AdminJournal[] {
  const anchor = seedAnchor.get();
  return SEED.map((seed) => {
    const createdAt = new Date(anchor - seed.minutesBefore * MINUTE_MS).toISOString();
    return {
      id: seed.id,
      idempotencyKey: seed.idempotencyKey,
      description: seed.description,
      reversesJournalId: null,
      createdAt,
      related: seed.related,
      attemptId: seed.attemptId,
      entries: seed.entries.map(([accountClass, amount, ownerName], index) => ({
        id: toMockUuid(`${seed.id}:${index}`),
        journalId: seed.id,
        accountId: accountIdOf(ownerName ?? `${seed.id}:${index}`, accountClass),
        amount,
        createdAt,
        accountClass,
        ownerName,
      })),
    };
  });
}

/** Display names per mock user id: legacy demo accounts + top-up requesters. */
function ownerNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const user of Object.values(loadStore().users)) names.set(toMockUuid(user.id), user.name);
  for (const { userId, request } of allTopUps()) {
    if (request.userName && !names.has(userId)) names.set(userId, request.userName);
  }
  return names;
}

/** Every user's wallet rows as backend-shaped journals (one per row, `ledgerItemsFromRows`). */
function walletJournals(): AdminJournal[] {
  const names = ownerNames();
  return Object.entries(transactions.get()).flatMap(([userId, rows]) => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const journals = new Map<string, AdminJournal>();
    for (const item of ledgerItemsFromRows(userId, rows)) {
      let journal = journals.get(item.journalId);
      if (!journal) {
        journal = {
          id: item.journalId,
          idempotencyKey: item.idempotencyKey,
          description: item.description,
          reversesJournalId: item.reversesJournalId,
          createdAt: item.createdAt,
          related: item.surveyTitle,
          attemptId: byId.get(item.journalId)?.attemptId ?? null,
          entries: [],
        };
        journals.set(item.journalId, journal);
      }
      journal.entries.push({
        id: item.id,
        journalId: item.journalId,
        accountId: accountIdOf(userId, item.accountClass),
        amount: item.amount,
        createdAt: item.createdAt,
        accountClass: item.accountClass,
        ownerName: names.get(userId) ?? null,
      });
    }
    return [...journals.values()];
  });
}

/** `GET /admin/ledger/journals` (ASSUMED): newest first (ties by id), filtered by type and time bounds. */
export function listAdminJournals(type: TransactionFilter, from: string | null, to: string | null = null): AdminJournal[] {
  return [...walletJournals(), ...seedJournals()]
    .filter((journal) => matchesTransactionFilter(journalKindOf(journal), type))
    .filter((journal) => (from === null || journal.createdAt >= from) && (to === null || journal.createdAt <= to))
    .sort(compareJournalsNewestFirst);
}

/** `GET /admin/ledger/summary` (ASSUMED): the four Figma cards. */
export function adminLedgerSummary(now = new Date()): AdminLedgerSummary {
  const balances = Object.values(wallets.get());
  const refunds = listAdminJournals("all", periodStartIso("today", now)).filter(
    (journal) => journalKindOf(journal) === "ESCROW_REFUND",
  );
  return {
    pendingTopUps: pendingTopUpSummary(),
    escrowTotal: mockEscrowTotal(),
    pendingTotal: balances.reduce((sum, wallet) => sum + wallet.pending, 0),
    refundedToday: {
      points: refunds.reduce(
        (sum, journal) => sum + journal.entries.reduce((total, entry) => total + Math.max(0, entry.amount), 0),
        0,
      ),
      surveys: refunds.length,
    },
  };
}

/**
 * Ledger operations (Story 14.4): demo ids for the "Vận hành" tab. MOCK-ONLY: the real ids
 * come from the database (integrity report, survey responses and attempts).
 */
export const LEDGER_OPS_DEMO = {
  /** Drifted user account (projected 120, entries sum to 100) until reconciled. */
  driftedAccountId: "14040000-0000-4000-8000-0000000000a1",
  /** Consistent system account (not in the drift list). */
  escrowAccountId: "14040000-0000-4000-8000-0000000000a2",
  /** Internal response with a settled reward. */
  settledResponseId: "14040000-0000-4000-8000-0000000000b1",
  /** External attempt whose reward waits 48 hours. */
  pendingAttemptId: "14040000-0000-4000-8000-0000000000c1",
  /** External attempt whose settlement is unavailable (answer `null`). */
  unavailableAttemptId: "14040000-0000-4000-8000-0000000000c2",
} as const;

interface MockLedgerAccount {
  userId: string | null;
  accountClass: LedgerAccountClass;
  projectedBalance: number;
  calculatedBalance: number;
}

interface LedgerOpsState {
  accounts: Record<string, MockLedgerAccount>;
  /** Pending rewards older than 48 hours that "Giải phóng" has not released yet. */
  maturedPending: number;
}

const ledgerOps = createCollection<LedgerOpsState>("admin-ledger-ops", () => ({
  accounts: {
    [LEDGER_OPS_DEMO.driftedAccountId]: {
      userId: FRAUD_SEED_USER_IDS.khang,
      accountClass: "USER_AVAILABLE",
      projectedBalance: 120,
      calculatedBalance: 100,
    },
    [LEDGER_OPS_DEMO.escrowAccountId]: {
      userId: null,
      accountClass: "ESCROW",
      projectedBalance: 4500,
      calculatedBalance: 4500,
    },
  },
  maturedPending: 14,
}));

const RELEASE_DEFAULT_LIMIT = 100;

/** `GET /economy/integrity`: entries always sum to zero in the mock; drift = projected ≠ calculated. */
export function ledgerOpsIntegrity(): LedgerIntegrityReport {
  const driftedAccounts = Object.entries(ledgerOps.get().accounts)
    .filter(([, account]) => account.projectedBalance !== account.calculatedBalance)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([accountId, account]) => ({ accountId, ...account }));
  return { totalSystemBalance: 0, isZeroSum: true, driftedAccounts, driftedAccountsTruncated: false };
}

/** `GET /economy/accounts/:id/balance`; `null` = unknown account (404). */
export function ledgerOpsBalance(accountId: string) {
  const account = ledgerOps.get().accounts[accountId];
  if (!account) return null;
  return {
    accountId,
    projectedBalance: account.projectedBalance,
    calculatedBalance: account.calculatedBalance,
    isConsistent: account.projectedBalance === account.calculatedBalance,
  };
}

/** `POST /economy/accounts/:id/reconcile`: the projected balance becomes the sum of the entries. */
export function ledgerOpsReconcile(accountId: string) {
  const account = ledgerOps.get().accounts[accountId];
  if (!account) return null;
  ledgerOps.update((draft) => {
    draft.accounts[accountId].projectedBalance = draft.accounts[accountId].calculatedBalance;
  });
  return { accountId, priorBalance: account.projectedBalance, correctedBalance: account.calculatedBalance };
}

/** `POST /economy/rewards/{internal,external}/:id`: `undefined` = not found (404), `null` = settlement unavailable. */
export function ledgerOpsRedrive(kind: "internal" | "external", id: string): RewardSettlementResultDto | null | undefined {
  const settledAt = nowIso();
  if (kind === "internal" && id === LEDGER_OPS_DEMO.settledResponseId) {
    return {
      status: "SETTLED",
      journalId: toMockUuid("ledger-ops:journal:settled"),
      amount: 30,
      targetAccountClass: "USER_AVAILABLE",
      settledAt,
    };
  }
  if (kind === "external" && id === LEDGER_OPS_DEMO.pendingAttemptId) {
    return {
      status: "PENDING",
      journalId: toMockUuid("ledger-ops:journal:pending"),
      amount: 20,
      targetAccountClass: "PENDING",
      settledAt,
    };
  }
  if (kind === "external" && id === LEDGER_OPS_DEMO.unavailableAttemptId) return null;
  return undefined;
}

/** `POST /economy/rewards/release-matured`: releases up to `limit` of the seeded matured credits. */
export function ledgerOpsRelease(limit: number | undefined): MaturedReleaseSummaryDto {
  const processed = Math.min(limit ?? RELEASE_DEFAULT_LIMIT, ledgerOps.get().maturedPending);
  const remaining = ledgerOps.update((draft) => {
    draft.maturedPending -= processed;
  }).maturedPending;
  const now = nowIso();
  return {
    processed,
    releasedCount: processed,
    disputedCount: 0,
    failedCount: 0,
    hasMore: remaining > 0,
    nextCursor:
      remaining > 0
        ? encodeMaturedReleaseCursor({ createdAt: now, journalId: toMockUuid(`ledger-ops:cursor:${remaining}`) })
        : null,
    cutoffDate: new Date(Date.now() - 48 * 3_600_000).toISOString(),
  };
}
