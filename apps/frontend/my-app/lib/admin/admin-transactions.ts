import type { LedgerAccountClass } from "@rescom/schemas";
import { vietnamDateKey } from "../format/date-time.ts";
import { historyKindOf, type HistoryKind } from "../wallet/wallet-history.ts";

/**
 * Pure rules of the admin ledger view (Figma 11f "Giao dịch điểm", 63:1629):
 * one row per journal, typed by its idempotency key prefix like the wallet
 * history (`historyKindOf`), with the "Từ → Đến" move between balance tiers.
 */

export type TransactionFilter = "all" | "top-up" | "escrow" | "reward" | "refund";

/** "Loại giao dịch" segments (Figma: Tất cả · Nạp · Ký quỹ · Thưởng · Hoàn). */
export const TRANSACTION_FILTERS = [
  { value: "all", label: "Tất cả" },
  { value: "top-up", label: "Nạp" },
  { value: "escrow", label: "Ký quỹ" },
  { value: "reward", label: "Thưởng" },
  { value: "refund", label: "Hoàn" },
] as const satisfies ReadonlyArray<{ value: TransactionFilter; label: string }>;

/**
 * Kinds per segment (ASSUMED grouping; the starter-point journals only show
 * under "Tất cả"): Thưởng = rewards and their 48h release / dispute hold,
 * Hoàn = points given back (escrow refund, dispute outcome, reversal).
 */
const FILTER_KINDS: Record<Exclude<TransactionFilter, "all">, readonly HistoryKind[]> = {
  "top-up": ["TOP_UP"],
  escrow: ["SURVEY_ESCROW"],
  reward: ["SURVEY_REWARD", "REWARD_RELEASE", "DISPUTE_HOLD"],
  refund: ["ESCROW_REFUND", "DISPUTE_RESOLUTION", "REVERSAL"],
};

export function isTransactionFilter(value: string): value is TransactionFilter {
  return TRANSACTION_FILTERS.some((item) => item.value === value);
}

export function matchesTransactionFilter(kind: HistoryKind, filter: TransactionFilter): boolean {
  return filter === "all" || FILTER_KINDS[filter].includes(kind);
}

export type TransactionPeriod = "today" | "7d" | "30d" | "all";

/** "Khoảng thời gian" select; Figma draws "Hôm nay", the other options are ASSUMED (design). */
export const TRANSACTION_PERIODS = [
  { value: "today", label: "Hôm nay" },
  { value: "7d", label: "7 ngày" },
  { value: "30d", label: "30 ngày" },
  { value: "all", label: "Tất cả" },
] as const satisfies ReadonlyArray<{ value: TransactionPeriod; label: string }>;

export function isTransactionPeriod(value: string): value is TransactionPeriod {
  return TRANSACTION_PERIODS.some((item) => item.value === value);
}

const DAY_MS = 86_400_000;

/**
 * First instant of the period in Vietnam time (UTC+7, no DST): "Hôm nay"
 * starts at 00:00 of the Vietnamese calendar day; "7 ngày" includes today.
 * `all` → null (no lower bound).
 */
export function periodStartIso(period: TransactionPeriod, now: Date): string | null {
  if (period === "all") return null;
  const startOfToday = Date.parse(`${vietnamDateKey(now)}T00:00:00+07:00`);
  const days = period === "today" ? 0 : period === "7d" ? 6 : 29;
  return new Date(startOfToday - days * DAY_MS).toISOString();
}

type JournalKey = { createdAt: string; id: string };

/** Journal list order (ASSUMED contract): newest first, ties by id descending. */
export function compareJournalsNewestFirst(a: JournalKey, b: JournalKey): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/** "Tải thêm" cursor (`before=`): `<createdAt>:<id>` of the last row shown. */
export function journalCursorOf(journal: JournalKey): string {
  return `${journal.createdAt}:${journal.id}`;
}

/** Splits `<createdAt>:<id>` at the last colon (ISO times contain colons, ids do not); null when malformed. */
export function parseJournalCursor(cursor: string): JournalKey | null {
  const at = cursor.lastIndexOf(":");
  if (at <= 0 || at === cursor.length - 1) return null;
  const createdAt = cursor.slice(0, at);
  const id = cursor.slice(at + 1);
  return Number.isNaN(Date.parse(createdAt)) ? null : { createdAt, id };
}

/** True when `journal` comes after the cursor row in list order (older, or same instant with a smaller id). */
export function isAfterJournalCursor(journal: JournalKey, cursor: JournalKey): boolean {
  return compareJournalsNewestFirst(cursor, journal) < 0;
}

/** The rows of a "Tải thêm" page not already shown (by id), in page order. */
export function newJournalRows<T extends { id: string }>(shown: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(shown.map((journal) => journal.id));
  return page.filter((journal) => !seen.has(journal.id));
}

/** Balance tier names used in "Từ → Đến" (Figma: Khả dụng, Ký quỹ, Chờ 48h, Đóng băng). */
const ACCOUNT_LABELS: Record<LedgerAccountClass, string> = {
  USER_AVAILABLE: "Khả dụng",
  PENDING: "Chờ 48h",
  FROZEN: "Đóng băng",
  ESCROW: "Ký quỹ",
  INTEGRITY_HOLD: "Đang giữ",
  SYSTEM_ISSUANCE: "Phát hành",
  SYSTEM_SINK: "Thu hồi",
  SYSTEM_CLEARING: "Chuyển khoản",
};

export function accountLabel(accountClass: LedgerAccountClass): string {
  return ACCOUNT_LABELS[accountClass];
}

/**
 * Source / destination when a journal lists only one side (the other is a
 * system account, or the mock only knows the user's side). ASSUMED from the
 * backend postings: a top-up comes from clearing, a reward from the
 * publisher's escrow, starter points from issuance.
 */
const IMPLIED_SOURCE: Partial<Record<HistoryKind, LedgerAccountClass>> = {
  TOP_UP: "SYSTEM_CLEARING",
  SURVEY_REWARD: "ESCROW",
  STARTER_GRANT: "SYSTEM_ISSUANCE",
  ESCROW_REFUND: "ESCROW",
  // `resolveDisputeHold`: the publisher's refund / respondent's release comes out of the Integrity Hold.
  DISPUTE_RESOLUTION: "INTEGRITY_HOLD",
};
const IMPLIED_DESTINATION: Partial<Record<HistoryKind, LedgerAccountClass>> = {
  STARTER_EXPIRY: "SYSTEM_SINK",
  SURVEY_ESCROW: "ESCROW",
};

/** Figma "Loại" copy for the admin view. */
const TITLES: Record<HistoryKind, string> = {
  STARTER_GRANT: "Cấp điểm khởi đầu",
  STARTER_UNLOCK: "Mở khoá điểm khởi đầu",
  STARTER_EXPIRY: "Điểm khởi đầu hết hạn",
  SURVEY_REWARD: "Thưởng khảo sát",
  REWARD_RELEASE: "Hết 48 giờ chờ",
  DISPUTE_HOLD: "Giữ điểm khi khiếu nại",
  DISPUTE_RESOLUTION: "Kết quả khiếu nại",
  TOP_UP: "Nạp điểm",
  SURVEY_ESCROW: "Khoá ký quỹ",
  ESCROW_REFUND: "Hoàn ký quỹ",
  REVERSAL: "Đảo giao dịch",
  OTHER: "Giao dịch",
};

function titleOf(kind: HistoryKind, key: string): string {
  if (kind === "DISPUTE_RESOLUTION") {
    // `dispute-resolution:{caseId}:refund` gives the reward back to the publisher (Figma "Đảo thưởng").
    if (key.endsWith(":refund")) return "Đảo thưởng";
    if (key.endsWith(":release")) return "Trả điểm sau khiếu nại";
  }
  return TITLES[kind];
}

/** "Liên quan" fallback when the journal names no survey (Figma copy where drawn, else ASSUMED (design)). */
function relatedFallback(kind: HistoryKind, key: string, description: string | null): string {
  switch (kind) {
    case "STARTER_GRANT":
      return "Tài khoản mới";
    case "STARTER_UNLOCK":
      return "Kích hoạt tài khoản";
    case "STARTER_EXPIRY":
      return "Quá 30 ngày chưa làm khảo sát";
    case "TOP_UP": {
      const reference = description?.match(/RESCOM[A-Z0-9]+/)?.[0];
      return reference ? `Chuyển khoản ${reference}` : "Chuyển khoản ngân hàng";
    }
    case "DISPUTE_RESOLUTION":
      return key.endsWith(":refund") ? "Khiếu nại được chấp nhận" : "Khiếu nại bị từ chối";
    case "DISPUTE_HOLD":
      return "Khiếu nại đang xét";
    case "ESCROW_REFUND":
      return "Khảo sát đóng / bị từ chối";
    case "REVERSAL":
      return "Hoàn tác một giao dịch trước";
    default:
      return "";
  }
}

/** "Nguyễn Thuỳ Linh" → "Linh N." (Figma "Linh N."): given name + family initial. */
export function shortPersonName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  return `${words[words.length - 1]} ${words[0].charAt(0).toLocaleUpperCase("vi-VN")}.`;
}

/** Anonymous attempt code "#7F3A" (Figma, same as the publisher's dispute screens). */
export function attemptCode(attemptId: string): string {
  return `#${attemptId.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

/** Attempt id carried by reward keys (`internal-reward:`, `external-completion:`, `release-pending:`, `integrity-*:`). */
const ATTEMPT_KEY_PREFIXES = [
  "internal-reward:",
  "external-completion:",
  "release-pending:",
  "integrity-hold:",
  "integrity-decision:",
  "integrity-fail-open:",
  "external-dispute:",
];
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function attemptIdFromKey(key: string): string | null {
  const prefix = ATTEMPT_KEY_PREFIXES.find((candidate) => key.startsWith(candidate));
  if (!prefix) return null;
  return key.slice(prefix.length).match(UUID_PREFIX)?.[0] ?? null;
}

export interface AdminJournalEntryInput {
  amount: number;
  accountClass?: LedgerAccountClass;
  ownerName?: string | null;
}

export interface AdminJournalInput {
  id: string;
  idempotencyKey: string;
  description: string | null;
  reversesJournalId: string | null;
  createdAt: string;
  entries: readonly AdminJournalEntryInput[];
  related?: string | null;
  attemptId?: string | null;
}

export type TransactionTone = "teal" | "amber" | "ink";

export interface AdminTransactionRow {
  id: string;
  kind: HistoryKind;
  createdAt: string;
  /** "Loại", e.g. "Hoàn ký quỹ". */
  title: string;
  /** "Từ → Đến", e.g. "Ký quỹ → Khả dụng · Linh N." */
  route: string;
  /** "Liên quan": survey title or a note. */
  related: string;
  /** Points moved (positive). */
  amount: number;
  tone: TransactionTone;
}

export function journalKindOf(journal: Pick<AdminJournalInput, "idempotencyKey" | "reversesJournalId">): HistoryKind {
  return historyKindOf(journal.idempotencyKey, journal.reversesJournalId);
}

/** Largest entry on one side (a journal may split across accounts). */
function sideOf(entries: readonly AdminJournalEntryInput[], sign: 1 | -1): AdminJournalEntryInput | undefined {
  return entries
    .filter((entry) => Math.sign(entry.amount) === sign && entry.accountClass)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
}

/**
 * Row of the "Giao dịch điểm" table. Colors follow Figma: points going back
 * to Khả dụng are teal, an escrow lock amber, anything else ink.
 */
export function toTransactionRow(journal: AdminJournalInput): AdminTransactionRow {
  const kind = journalKindOf(journal);
  const credit = sideOf(journal.entries, 1);
  const debit = sideOf(journal.entries, -1);
  const from = debit?.accountClass ?? IMPLIED_SOURCE[kind];
  const to = credit?.accountClass ?? IMPLIED_DESTINATION[kind];
  const amount = journal.entries.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0)
    || journal.entries.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

  const attemptId = journal.attemptId ?? attemptIdFromKey(journal.idempotencyKey);
  const owner = (credit ?? debit)?.ownerName ?? (debit ?? credit)?.ownerName ?? null;
  const party = attemptId ? attemptCode(attemptId) : owner ? shortPersonName(owner) : "";
  const move = [from, to].filter((value): value is LedgerAccountClass => Boolean(value)).map(accountLabel).join(" → ");
  const route = [move, party].filter(Boolean).join(" · ");

  const tone: TransactionTone = kind === "SURVEY_ESCROW" ? "amber" : to === "USER_AVAILABLE" ? "teal" : "ink";
  return {
    id: journal.id,
    kind,
    createdAt: journal.createdAt,
    title: titleOf(kind, journal.idempotencyKey),
    route,
    related: journal.related || relatedFallback(kind, journal.idempotencyKey, journal.description),
    amount,
    tone,
  };
}
