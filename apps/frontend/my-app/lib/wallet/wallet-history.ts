import { EXTERNAL_COMPLETION_REVIEW_HOURS, type LedgerAccountClass } from "@rescom/schemas";
import { formatPoints } from "./top-up.ts";
import type { WalletTransaction } from "./wallet-service.ts";

/**
 * Figma 7 "Lịch sử giao dịch" rows, derived from the VERIFIED ledger entries
 * of `GET /economy/wallet`.
 *
 * The backend returns one item per ledger *entry* on the user's accounts, so
 * a move between two of them (starter unlock Đóng băng → Khả dụng, survey
 * escrow Khả dụng → Ký quỹ) arrives as two entries of one journal. Figma
 * shows one row per operation, so entries are grouped by `journalId`. The
 * operation type comes from the journal idempotency key prefix
 * (`starter-grant:`, `external-completion:`, `topup-approval:`… — backend
 * `ledger.service.ts`, `reward-settlement.coordinator.ts`, `top-up.schema.ts`).
 *
 * Direction comes from the caller's own entries: one journal can be income
 * for the respondent and spending for the publisher (a survey reward draws
 * the publisher's Ký quỹ; a dispute refund takes the respondent's hold), and
 * the caller only sees their side.
 */

export type HistoryKind =
  | "STARTER_GRANT"
  | "STARTER_UNLOCK"
  | "STARTER_EXPIRY"
  | "SURVEY_REWARD"
  | "REWARD_RELEASE"
  | "DISPUTE_HOLD"
  | "DISPUTE_RESOLUTION"
  | "TOP_UP"
  | "SURVEY_ESCROW"
  | "ESCROW_REFUND"
  | "REVERSAL"
  | "OTHER";

/**
 * "in" received (+), "out" spent (−), "neutral" a move that neither adds nor
 * spends (Chờ duyệt → Đang giữ on a dispute): no sign, only in "Tất cả".
 */
export type HistoryDirection = "in" | "out" | "neutral";

/** Transaction filter (Figma 62:303 desktop "Tất cả · Nhận · Chi · Nạp", 62:1105 mobile without "Nạp"). */
export type HistoryFilter = "all" | "in" | "out" | "top-up";

export interface HistoryRow {
  /** The journal id (one row per operation). */
  id: string;
  kind: HistoryKind;
  /** "Loại" column, e.g. "Thưởng khảo sát". */
  title: string;
  /** "Khảo sát / ghi chú" column (survey title or a note). */
  note: string;
  /** Shorter note for the mobile list ("Đóng băng → Khả dụng"). */
  shortNote: string;
  createdAt: string;
  /** Points received (+) or spent (−); neutral moves are positive. */
  amount: number;
  direction: HistoryDirection;
  /** Where the points are now (status pill). */
  bucket: LedgerAccountClass;
  /** Pending survey reward still in its 48h review: whole hours left, else null. */
  pendingHoursLeft: number | null;
  /**
   * Pending survey reward past its 48h review whose `release-pending:` journal
   * has not been posted yet (the backend maturity scan releases it; the
   * frontend never calls the release route): "Sắp vào Khả dụng".
   */
  pendingDue: boolean;
}

const KEY_PREFIXES: ReadonlyArray<readonly [string, HistoryKind]> = [
  ["starter-grant:", "STARTER_GRANT"],
  ["starter-unlock:", "STARTER_UNLOCK"],
  ["starter-expiry:", "STARTER_EXPIRY"],
  ["internal-reward:", "SURVEY_REWARD"],
  ["external-completion:", "SURVEY_REWARD"],
  ["integrity-hold:", "SURVEY_REWARD"],
  ["release-pending:", "REWARD_RELEASE"],
  ["integrity-decision:", "REWARD_RELEASE"],
  ["integrity-fail-open:", "REWARD_RELEASE"],
  ["external-dispute:", "DISPUTE_HOLD"],
  ["dispute-resolution:", "DISPUTE_RESOLUTION"],
  ["topup-approval:", "TOP_UP"],
  ["publish:", "SURVEY_ESCROW"],
  ["reopen-escrow:", "SURVEY_ESCROW"],
  ["close-refund:", "ESCROW_REFUND"],
];

export function historyKindOf(idempotencyKey: string, reversesJournalId: string | null): HistoryKind {
  if (reversesJournalId) return "REVERSAL";
  const match = KEY_PREFIXES.find(([prefix]) => idempotencyKey.startsWith(prefix));
  return match ? match[1] : "OTHER";
}

/**
 * Direction of a journal whose entries on the caller's accounts sum to 0
 * (a move between two of them). Anything else follows the sign of that sum.
 */
const ZERO_NET_DIRECTION: Partial<Record<HistoryKind, HistoryDirection>> = {
  STARTER_UNLOCK: "in",
  REWARD_RELEASE: "in",
  DISPUTE_RESOLUTION: "in",
  ESCROW_REFUND: "in",
  SURVEY_ESCROW: "out",
  STARTER_EXPIRY: "out",
  // Chờ duyệt → Đang giữ: the points are still the user's, nothing received or spent.
  DISPUTE_HOLD: "neutral",
};

const TITLES: Record<HistoryKind, string> = {
  STARTER_GRANT: "Điểm khởi đầu",
  STARTER_UNLOCK: "Mở khoá điểm khởi đầu",
  STARTER_EXPIRY: "Điểm khởi đầu hết hạn",
  SURVEY_REWARD: "Thưởng khảo sát",
  REWARD_RELEASE: "Điểm chờ duyệt đã mở",
  DISPUTE_HOLD: "Giữ điểm khi khiếu nại",
  DISPUTE_RESOLUTION: "Kết quả khiếu nại",
  TOP_UP: "Nạp điểm",
  SURVEY_ESCROW: "Ký quỹ khảo sát",
  ESCROW_REFUND: "Hoàn ký quỹ",
  REVERSAL: "Điều chỉnh giao dịch",
  OTHER: "Giao dịch",
};

/**
 * Title of one side of a journal. A survey reward seen by its publisher (only
 * their Ký quỹ entry, negative) is a payout; a dispute resolution is told
 * apart by its key suffix (`dispute-resolution:{caseId}:release|refund`,
 * backend `dispute-hold.ts`). ASSUMED copy (not drawn).
 */
function titleOf(kind: HistoryKind, key: string, direction: HistoryDirection, entries: readonly WalletTransaction[]): string {
  if (kind === "SURVEY_REWARD" && direction === "out" && entries.every((entry) => entry.accountClass === "ESCROW")) {
    return "Trả thưởng khảo sát";
  }
  if (kind === "DISPUTE_RESOLUTION") {
    if (key.endsWith(":refund")) return direction === "out" ? "Thu hồi sau khiếu nại" : "Hoàn điểm khiếu nại";
    if (key.endsWith(":release")) return "Trả điểm sau khiếu nại";
  }
  return TITLES[kind];
}

/** Survey title embedded by the backend in escrow descriptions ("Escrow lock for survey publish: <title>"). */
function titleFromDescription(description: string | null): string | null {
  if (!description) return null;
  const index = description.indexOf(": ");
  if (index < 0) return null;
  const title = description
    .slice(index + 2)
    .replace(/ \(\d+ unused slots\)$/, "")
    .trim();
  return title || null;
}

function notesOf(kind: HistoryKind, entry: WalletTransaction, payout: boolean): { note: string; shortNote: string } {
  if (payout) return { note: "Khảo sát của bạn", shortNote: "Khảo sát của bạn" };
  switch (kind) {
    case "STARTER_GRANT":
      return { note: "Tài khoản mới", shortNote: "Tài khoản mới" };
    case "STARTER_UNLOCK":
      return { note: "Đóng băng → Khả dụng sau khảo sát đầu tiên", shortNote: "Đóng băng → Khả dụng" };
    case "STARTER_EXPIRY":
      return { note: "Quá 30 ngày chưa hoàn thành khảo sát đầu tiên", shortNote: "Quá 30 ngày" };
    case "SURVEY_REWARD":
      return { note: "Khảo sát", shortNote: "Khảo sát" };
    case "REWARD_RELEASE":
      return { note: "Chờ duyệt → Khả dụng", shortNote: "Chờ duyệt → Khả dụng" };
    case "DISPUTE_HOLD":
    case "DISPUTE_RESOLUTION":
      return { note: "Khiếu nại khảo sát", shortNote: "Khiếu nại" };
    case "TOP_UP": {
      const reference = entry.description?.match(/RESCOM[A-Z0-9]+/)?.[0];
      const note = reference ? `Chuyển khoản ${reference}` : "Chuyển khoản ngân hàng";
      return { note, shortNote: note };
    }
    case "SURVEY_ESCROW":
    case "ESCROW_REFUND": {
      const title = titleFromDescription(entry.description) ?? "Khảo sát của bạn";
      return { note: title, shortNote: title };
    }
    case "REVERSAL":
      return { note: "Hoàn tác một giao dịch trước", shortNote: "Hoàn tác" };
    default:
      return { note: "", shortNote: "" };
  }
}

function largest(entries: WalletTransaction[]): WalletTransaction | undefined {
  return entries.reduce<WalletTransaction | undefined>(
    (best, entry) => (!best || Math.abs(entry.amount) > Math.abs(best.amount) ? entry : best),
    undefined,
  );
}

const HOUR_MS = 3_600_000;

/** Attempt id of `external-completion:<id>` / `release-pending:<id>` keys. */
function attemptKeyOf(idempotencyKey: string, prefix: string): string | null {
  return idempotencyKey.startsWith(prefix) ? idempotencyKey.slice(prefix.length) : null;
}

/** Attempt id in an `external-dispute:{caseId}` hold description (backend `dispute-hold.ts`). */
const DISPUTE_HOLD_ATTEMPT = /external attempt: (\S+) [(]Case /;

/** Groups ledger entries into Figma rows, newest first (the API order). */
export function toHistoryRows(transactions: readonly WalletTransaction[], now: Date = new Date()): HistoryRow[] {
  const groups = new Map<string, WalletTransaction[]>();
  for (const entry of transactions) {
    const group = groups.get(entry.journalId);
    if (group) group.push(entry);
    else groups.set(entry.journalId, [entry]);
  }

  const reversed = new Set<string>();
  for (const entry of transactions) {
    if (entry.reversesJournalId) reversed.add(entry.reversesJournalId);
  }
  // Pending credits whose 48h review is over (released) or suspended (dispute hold).
  const released = new Set<string>();
  const held = new Set<string>();
  for (const entry of transactions) {
    const releasedAttempt = attemptKeyOf(entry.idempotencyKey, "release-pending:");
    if (releasedAttempt && !reversed.has(entry.journalId)) released.add(releasedAttempt);
    if (entry.idempotencyKey.startsWith("external-dispute:") && !reversed.has(entry.journalId)) {
      const heldAttempt = entry.description?.match(DISPUTE_HOLD_ATTEMPT)?.[1];
      if (heldAttempt) held.add(heldAttempt);
    }
  }

  const rows: HistoryRow[] = [];
  for (const [journalId, entries] of groups) {
    const first = entries[0];
    const kind = historyKindOf(first.idempotencyKey, first.reversesJournalId);
    const positive = entries.filter((entry) => entry.amount > 0);
    const negative = entries.filter((entry) => entry.amount < 0);
    const received = positive.reduce((sum, entry) => sum + entry.amount, 0);
    const spent = negative.reduce((sum, entry) => sum - entry.amount, 0);
    const net = received - spent;

    // The caller's own net first; the kind only decides moves between their accounts.
    const direction: HistoryDirection =
      net < 0 ? "out" : net > 0 ? "in" : (ZERO_NET_DIRECTION[kind] ?? "neutral");
    const magnitude = Math.max(received, spent);
    // Status pill = where the points went; spending with no user-side destination
    // (expiry, a publisher's payout) shows the account they left.
    let bucket = (largest(positive) ?? largest(negative) ?? first).accountClass;
    const payout = kind === "SURVEY_REWARD" && direction === "out";

    let pendingHoursLeft: number | null = null;
    let pendingDue = false;
    const attemptId = attemptKeyOf(first.idempotencyKey, "external-completion:");
    // A released pending reward now sits in Khả dụng (its `release-pending:` journal moved it).
    if (bucket === "PENDING" && attemptId && released.has(attemptId) && !reversed.has(journalId)) {
      bucket = "USER_AVAILABLE";
    }
    if (
      kind === "SURVEY_REWARD" &&
      bucket === "PENDING" &&
      direction === "in" &&
      attemptId &&
      !released.has(attemptId) &&
      !held.has(attemptId) &&
      !reversed.has(journalId)
    ) {
      const releaseAt = new Date(first.createdAt).getTime() + EXTERNAL_COMPLETION_REVIEW_HOURS * HOUR_MS;
      const left = Math.ceil((releaseAt - now.getTime()) / HOUR_MS);
      if (left > 0) pendingHoursLeft = left;
      else pendingDue = true;
    }

    rows.push({
      id: journalId,
      kind,
      title: titleOf(kind, first.idempotencyKey, direction, entries),
      ...notesOf(kind, first, payout),
      createdAt: first.createdAt,
      amount: direction === "out" ? -magnitude : magnitude,
      direction,
      bucket,
      pendingHoursLeft,
      pendingDue,
    });
  }
  return rows;
}

/**
 * A full page (`limit` entries) may end inside a journal whose other entries
 * are on the next page: its entries are left out until that page is loaded,
 * so no row shows half an operation.
 */
export function dropTrailingJournal(
  transactions: readonly WalletTransaction[],
  pageIsFull: boolean,
): WalletTransaction[] {
  if (!pageIsFull || transactions.length === 0) return [...transactions];
  const last = transactions[transactions.length - 1].journalId;
  return transactions.filter((entry) => entry.journalId !== last);
}

/** Appends an older page, skipping entries already listed (offsets shift when new entries post). */
export function appendTransactions(
  current: readonly WalletTransaction[],
  page: readonly WalletTransaction[],
): WalletTransaction[] {
  const seen = new Set(current.map((entry) => entry.id));
  return [...current, ...page.filter((entry) => !seen.has(entry.id))];
}

export function filterHistory(rows: readonly HistoryRow[], filter: HistoryFilter): HistoryRow[] {
  switch (filter) {
    case "in":
      return rows.filter((row) => row.direction === "in");
    case "out":
      return rows.filter((row) => row.direction === "out");
    case "top-up":
      return rows.filter((row) => row.kind === "TOP_UP");
    default:
      return [...rows];
  }
}

/** Figma 7 "Chờ duyệt · Còn 31 giờ": the soonest pending reward to mature, or null. */
export function nextPendingReleaseHours(rows: readonly HistoryRow[]): number | null {
  const hours = rows.map((row) => row.pendingHoursLeft).filter((value): value is number => value !== null);
  return hours.length > 0 ? Math.min(...hours) : null;
}

/** A pending reward is past its 48h review but not released yet ("Sắp vào Khả dụng"). */
export function hasDuePendingRelease(rows: readonly HistoryRow[]): boolean {
  return rows.some((row) => row.pendingDue);
}

/** "+18" / "−1.000" (true minus sign, vi-VN grouping). */
export function formatSignedPoints(amount: number): string {
  return amount < 0 ? `−${formatPoints(Math.abs(amount))}` : `+${formatPoints(amount)}`;
}

/** Row amount: signed, except neutral moves ("18"). */
export function formatRowPoints(row: Pick<HistoryRow, "amount" | "direction">): string {
  return row.direction === "neutral" ? formatPoints(Math.abs(row.amount)) : formatSignedPoints(row.amount);
}

export interface BucketPresentation {
  label: string;
  tone: "amber" | "teal" | "green" | "neutral";
}

/**
 * Status pill per account (Figma 7: Chờ duyệt amber, Khả dụng teal, Đóng băng
 * green). Ký quỹ / Đang giữ are not drawn in the history — ASSUMED (design) tones.
 */
export function bucketPresentation(bucket: LedgerAccountClass): BucketPresentation {
  switch (bucket) {
    case "PENDING":
      return { label: "Chờ duyệt", tone: "amber" };
    case "USER_AVAILABLE":
      return { label: "Khả dụng", tone: "teal" };
    case "FROZEN":
      return { label: "Đóng băng", tone: "green" };
    case "INTEGRITY_HOLD":
      return { label: "Đang giữ để xét", tone: "amber" };
    case "ESCROW":
      return { label: "Ký quỹ", tone: "neutral" };
    default:
      return { label: "Hệ thống", tone: "neutral" };
  }
}

/** ASSUMED (design) copy (not drawn): a matured pending reward waiting for its release journal. */
export const PENDING_DUE_LABEL = "Sắp vào Khả dụng";

/**
 * Pill of one row: the account the points are in, except a matured pending
 * reward ("Sắp vào Khả dụng") and a respondent's refunded dispute hold, whose
 * points left the user (ASSUMED "Đã thu hồi").
 */
export function rowPresentation(row: HistoryRow): BucketPresentation {
  if (row.pendingDue) return { label: PENDING_DUE_LABEL, tone: "amber" };
  if (row.kind === "DISPUTE_RESOLUTION" && row.direction === "out") return { label: "Đã thu hồi", tone: "neutral" };
  return bucketPresentation(row.bucket);
}

/** Desktop pill text: "Chờ duyệt · còn 31 giờ". */
export function statusLabel(row: HistoryRow): string {
  const { label } = rowPresentation(row);
  return row.pendingHoursLeft !== null ? `${label} · còn ${row.pendingHoursLeft} giờ` : label;
}
