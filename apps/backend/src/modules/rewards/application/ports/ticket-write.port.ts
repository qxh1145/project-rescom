import {
  CodeIssueReason,
  CodeIssueStatus,
  AdminCodeIssueDto,
} from '@rescom/schemas';
import { ClaimedVoucherCode } from './redemption-repository.port';

export const TICKET_WRITE_PORT = Symbol('TICKET_WRITE_PORT');

export interface LockedRedemptionRecord {
  id: string;
  userId: string;
  voucherId: string;
  voucherCodeId: string | null;
  flashSaleItemId: string | null;
  quoteId: string | null;
  status: string;
  pricePoints: number;
  priceSource: 'BASE' | 'PROMO' | 'FLASH';
  journalId: string | null;
  reference: string;
  createdAt: Date | string;
  codeExpiresAt: Date | string;
  usedAt: Date | string | null;
  undoUntil: Date | string | null;
  refunded: boolean;
  latestReport: {
    id: string;
    reason: CodeIssueReason;
    status: CodeIssueStatus;
    note: string | null;
    createdAt: Date | string;
    resolvedAt: Date | string | null;
    replacementCodeId: string | null;
    replacementCode: string | null;
    refundJournalId: string | null;
    resolutionNote: string | null;
  } | null;
}

export interface LockedReportRecord {
  id: string;
  redemptionId: string;
  reason: CodeIssueReason;
  note: string | null;
  status: CodeIssueStatus;
  createdAt: Date | string;
  resolvedAt: Date | string | null;
  replacementCodeId: string | null;
  refundJournalId: string | null;
  resolvedById: string | null;
  resolutionNote: string | null;
}

export interface InsertUsageParams {
  redemptionId: string;
  usedAt: Date;
  undoUntil: Date;
}

export interface InsertReportParams {
  id: string;
  redemptionId: string;
  reason: CodeIssueReason;
  note?: string | null;
  createdAt: Date;
}

export interface InsertRefundParams {
  id: string;
  redemptionId: string;
  reportId: string;
  journalId: string;
  reference: string;
  points: number;
  createdAt: Date;
}

export interface AdminCodeIssueFilterParams {
  status?: 'OPEN' | 'RESOLVED' | 'ALL';
  limit: number;
  offset: number;
}

export interface AdminCodeIssueListResult {
  items: AdminCodeIssueDto[];
  total: number;
  openCount: number;
  oldestOpenAt: string | null;
}

export interface CandidateReminderRecord {
  redemptionId: string;
  userId: string;
  voucherId: string;
  redeemedAt: Date;
  expiresAt: Date;
}

export interface TicketWritePort {
  /**
   * Locks redemption row using `SELECT ... FOR UPDATE` and loads current usage, refund, and latest report facts.
   */
  lockRedemption(id: string): Promise<LockedRedemptionRecord | null>;

  /**
   * Inserts redemption_usages row.
   */
  insertUsage(params: InsertUsageParams): Promise<void>;

  /**
   * Deletes redemption_usages row on undo.
   */
  deleteUsage(redemptionId: string): Promise<boolean>;

  /**
   * Inserts code_issue_reports row in OPEN status.
   */
  insertReport(params: InsertReportParams): Promise<void>;

  /**
   * Finds report by ID.
   */
  findReport(id: string): Promise<LockedReportRecord | null>;

  /**
   * Points refunded for a report, or null when it has no refund.
   */
  findRefundPoints(reportId: string): Promise<number | null>;

  /**
   * Locks code_issue_reports row using `SELECT ... FOR UPDATE`.
   */
  lockReport(id: string): Promise<LockedReportRecord | null>;

  /**
   * Marks report REPLACED with replacementCodeId, resolvedById, resolvedAt.
   * Returns true if affected rows === 1, false otherwise.
   */
  markReportReplaced(
    reportId: string,
    replacementCodeId: string,
    resolvedById: string,
    resolvedAt: Date,
    resolutionNote?: string | null,
  ): Promise<boolean>;

  /**
   * Marks report REFUNDED with refundJournalId, resolvedById, resolvedAt.
   * Returns true if affected rows === 1, false otherwise.
   */
  markReportRefunded(
    reportId: string,
    refundJournalId: string,
    resolvedById: string,
    resolvedAt: Date,
    resolutionNote?: string | null,
  ): Promise<boolean>;

  /**
   * Marks report REJECTED with resolvedById, resolvedAt, resolutionNote.
   * Returns true if affected rows === 1, false otherwise.
   */
  markReportRejected(
    reportId: string,
    resolvedById: string,
    resolvedAt: Date,
    resolutionNote: string,
  ): Promise<boolean>;

  /**
   * Claims a replacement code using `FOR UPDATE SKIP LOCKED` where redemption_id IS NULL AND issue_report_id IS NULL,
   * then updates issue_report_id to the reportId.
   */
  claimReplacementCode(
    voucherId: string,
    reportId: string,
  ): Promise<ClaimedVoucherCode | null>;

  /**
   * Inserts redemption_refunds row (append-only).
   */
  insertRefund(params: InsertRefundParams): Promise<void>;

  /**
   * Deletes flash_item_claims row for the redemption (releases perUserCap for the user).
   */
  deleteFlashClaim(redemptionId: string): Promise<boolean>;

  /**
   * Lists code issues for the Admin queue with pagination and summary.
   */
  listReportsForAdmin(
    params: AdminCodeIssueFilterParams,
    now: number,
  ): Promise<AdminCodeIssueListResult>;

  /**
   * Finds a single report for admin with full resolution facts.
   */
  findReportForAdmin(
    id: string,
    now: number,
  ): Promise<AdminCodeIssueDto | null>;

  /**
   * Scans SUCCEEDED redemptions whose voucher code_expires_at is in (now, now + 7 d],
   * with no redemption_usages row and no redemption_refunds row, ordered by code_expires_at ASC.
   */
  findReminderCandidates(
    now: Date,
    limit: number,
  ): Promise<CandidateReminderRecord[]>;

  /**
   * Inserts redemption_reminders row with ON CONFLICT DO NOTHING.
   * Returns true if a row was inserted, false if conflict (already recorded).
   */
  recordReminderSent(
    redemptionId: string,
    window: '1D' | '7D',
    emittedAt: Date,
  ): Promise<boolean>;
}
