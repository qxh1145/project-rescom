import type { LedgerAccountClass } from "@rescom/schemas";
import {
  journalKindOf,
  matchesTransactionFilter,
  periodStartIso,
  type TransactionFilter,
} from "@/lib/admin/admin-transactions";
import type { AdminJournal, AdminLedgerSummary } from "@/lib/admin/transactions-service";
import { vietnamDateKey } from "@/lib/format/date-time";
import { loadStore } from "@/lib/mock/store.ts";
import { pendingTopUpSummary } from "./admin-top-ups";
import { toMockUuid } from "./auth";
import { transactions, wallets } from "./economy";
import { ledgerItemsFromRows } from "./economy-rules";
import { allTopUps } from "./top-up";
import { createCollection } from "../db/store";

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

/** `GET /admin/ledger/journals` (ASSUMED): newest first, filtered by type and lower time bound. */
export function listAdminJournals(type: TransactionFilter, from: string | null): AdminJournal[] {
  return [...walletJournals(), ...seedJournals()]
    .filter((journal) => matchesTransactionFilter(journalKindOf(journal), type))
    .filter((journal) => from === null || journal.createdAt >= from)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** `GET /admin/ledger/summary` (ASSUMED): the four Figma cards. */
export function adminLedgerSummary(now = new Date()): AdminLedgerSummary {
  const balances = Object.values(wallets.get());
  const refunds = listAdminJournals("all", periodStartIso("today", now)).filter(
    (journal) => journalKindOf(journal) === "ESCROW_REFUND",
  );
  return {
    pendingTopUps: pendingTopUpSummary(),
    escrowTotal: balances.reduce((sum, wallet) => sum + wallet.escrow, 0),
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
