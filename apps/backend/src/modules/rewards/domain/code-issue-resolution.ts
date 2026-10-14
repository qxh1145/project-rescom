export type CodeIssueOutcome = 'REPLACE' | 'REFUND' | 'REJECT';

export interface CodeIssueReportFacts {
  id: string;
  status: string; // 'OPEN' | 'REPLACED' | 'REFUNDED' | 'REJECTED'
}

export interface TicketFactsForResolution {
  expiresAt: string | Date | number;
  refunded: boolean;
}

export interface VoucherFactsForResolution {
  isSharedCode: boolean;
  stockRemaining: number;
  codesAvailable: number;
}

export type ResolveDecision =
  { ok: true } | { ok: false; status: 409; code: string };

/**
 * Validates resolution decision:
 * - report must be OPEN
 * - REJECT: needs no ticket/voucher facts, always allowed on OPEN report
 * - REFUND: allowed on expired ticket (reported in time), but rejected if already refunded (TICKET_REFUNDED)
 * - REPLACE:
 *   - rejected for shared-code voucher (REPLACEMENT_NOT_SUPPORTED)
 *   - rejected for expired ticket (TICKET_EXPIRED)
 *   - rejected if stockRemaining <= 0 or codesAvailable <= 0 (NO_REPLACEMENT_AVAILABLE)
 */
export function resolveDecision(
  report: CodeIssueReportFacts,
  ticket: TicketFactsForResolution,
  voucher: VoucherFactsForResolution,
  outcome: CodeIssueOutcome,
  now: number,
): ResolveDecision {
  if (report.status !== 'OPEN') {
    return { ok: false, status: 409, code: 'CODE_ISSUE_ALREADY_RESOLVED' };
  }

  if (outcome === 'REJECT') {
    return { ok: true };
  }

  if (outcome === 'REFUND') {
    if (ticket.refunded) {
      return { ok: false, status: 409, code: 'TICKET_REFUNDED' };
    }
    return { ok: true };
  }

  if (outcome === 'REPLACE') {
    if (voucher.isSharedCode) {
      return { ok: false, status: 409, code: 'REPLACEMENT_NOT_SUPPORTED' };
    }
    const expiresAtMs = +new Date(ticket.expiresAt);
    if (now >= expiresAtMs) {
      return { ok: false, status: 409, code: 'TICKET_EXPIRED' };
    }
    if (voucher.stockRemaining <= 0 || voucher.codesAvailable <= 0) {
      return { ok: false, status: 409, code: 'NO_REPLACEMENT_AVAILABLE' };
    }
    return { ok: true };
  }

  return { ok: false, status: 409, code: 'INVALID_RESOLUTION_OUTCOME' };
}
