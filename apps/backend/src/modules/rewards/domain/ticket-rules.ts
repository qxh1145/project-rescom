import { VoucherTicketStatus } from '@rescom/schemas';

export const VN_OFFSET_MS = 7 * 3_600_000;
export const UNDO_WINDOW_MS = 86_400_000;

export interface TicketFacts {
  usedAt: string | Date | null;
  undoUntil: string | Date | null;
  expiresAt: string | Date;
  refunded?: boolean;
  openIssue?: { status: string } | null;
}

export type TicketDecision =
  | { ok: false; status: 409; code: string }
  | { ok: true; changed: boolean; usedAt?: string; undoUntil?: string };

const REFUNDED: TicketDecision = {
  ok: false,
  status: 409,
  code: 'TICKET_REFUNDED',
};

export function isRefunded(ticket: TicketFacts): boolean {
  return ticket.refunded === true || ticket.openIssue?.status === 'REFUNDED';
}

/**
 * Calculates ticket status:
 * - USED if usedAt is present
 * - EXPIRED if expiresAt <= now
 * - EXPIRING if expiresAt - now <= 7 days
 * - UNUSED otherwise
 */
export function calculateTicketStatus(
  expiresAt: string | Date,
  usedAt: string | Date | null,
  now: number,
): VoucherTicketStatus {
  if (usedAt) return 'USED';
  const remaining = +new Date(expiresAt) - now;
  if (remaining <= 0) return 'EXPIRED';
  if (remaining <= 7 * 86_400_000) return 'EXPIRING';
  return 'UNUSED';
}

/**
 * Mark used decision:
 * - Refunded -> 409 TICKET_REFUNDED
 * - Expired -> 409 TICKET_EXPIRED
 * - Already used -> ok, changed: false
 * - New use -> ok, changed: true, usedAt, undoUntil = usedAt + 24h
 */
export function markUsedDecision(
  ticket: TicketFacts,
  now: number,
): TicketDecision {
  if (isRefunded(ticket)) return REFUNDED;
  if (
    calculateTicketStatus(ticket.expiresAt, ticket.usedAt, now) === 'EXPIRED'
  ) {
    return { ok: false, status: 409, code: 'TICKET_EXPIRED' };
  }
  if (ticket.usedAt) return { ok: true, changed: false };
  return {
    ok: true,
    changed: true,
    usedAt: new Date(now).toISOString(),
    undoUntil: new Date(now + UNDO_WINDOW_MS).toISOString(),
  };
}

/**
 * Undo use decision:
 * - Refunded -> 409 TICKET_REFUNDED
 * - Expired -> 409 TICKET_EXPIRED
 * - Not used -> ok, changed: false (200 no-op)
 * - Window passed (now >= undoUntil) -> 409 UNDO_WINDOW_CLOSED
 * - Within window -> ok, changed: true
 */
export function undoUseDecision(
  ticket: TicketFacts,
  now: number,
): TicketDecision {
  if (isRefunded(ticket)) return REFUNDED;
  if (+new Date(ticket.expiresAt) <= now) {
    return { ok: false, status: 409, code: 'TICKET_EXPIRED' };
  }
  if (!ticket.usedAt) return { ok: true, changed: false };
  if (!ticket.undoUntil || now >= +new Date(ticket.undoUntil)) {
    return { ok: false, status: 409, code: 'UNDO_WINDOW_CLOSED' };
  }
  return { ok: true, changed: true };
}

/**
 * Code issue report decision:
 * - Refunded -> 409 TICKET_REFUNDED
 * - Expired -> 409 TICKET_EXPIRED
 * - Already open -> 409 CODE_ISSUE_ALREADY_OPEN
 * - Allowed -> ok, changed: true
 */
export function codeIssueDecision(
  ticket: TicketFacts,
  now: number,
): TicketDecision {
  if (isRefunded(ticket)) return REFUNDED;
  if (
    calculateTicketStatus(ticket.expiresAt, ticket.usedAt, now) === 'EXPIRED'
  ) {
    return { ok: false, status: 409, code: 'TICKET_EXPIRED' };
  }
  if (ticket.openIssue?.status === 'OPEN') {
    return { ok: false, status: 409, code: 'CODE_ISSUE_ALREADY_OPEN' };
  }
  return { ok: true, changed: true };
}

export interface HistoryRowForSummary {
  kind: 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  points: number;
  createdAt: string | Date;
}

/**
 * Calculates current Asia/Ho_Chi_Minh month summary.
 * pointsSpent = SUCCEEDED spend minus REFUNDED points
 * voucherCount = #SUCCEEDED - #REFUNDED
 */
export function historyMonthSummary(
  rows: HistoryRowForSummary[],
  now: number,
): { month: string; pointsSpent: number; voucherCount: number } {
  const monthOf = (time: number) =>
    new Date(time + VN_OFFSET_MS).toISOString().slice(0, 7);
  const month = monthOf(now);
  let pointsSpent = 0;
  let voucherCount = 0;

  for (const row of rows) {
    if (monthOf(+new Date(row.createdAt)) !== month) continue;
    if (row.kind === 'SUCCEEDED') {
      pointsSpent -= row.points; // row.points is negative, so -(-price) = +price
      voucherCount++;
    } else if (row.kind === 'REFUNDED') {
      pointsSpent -= row.points; // row.points is positive, so -points decreases pointsSpent
      voucherCount--;
    }
  }

  return { month, pointsSpent, voucherCount };
}
