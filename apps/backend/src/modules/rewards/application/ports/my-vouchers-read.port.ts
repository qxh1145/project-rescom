import { VoucherTicketDto, RedemptionHistoryEntryDto } from '@rescom/schemas';
import { HistoryRowForSummary } from '../../domain/ticket-rules';

export const MY_VOUCHERS_READ_PORT = Symbol('MY_VOUCHERS_READ_PORT');

export interface TicketListResult {
  items: VoucherTicketDto[];
  total: number;
}

export interface TicketDetailResult {
  ticket: VoucherTicketDto;
  refunded: boolean;
}

export interface RedemptionHistoryListResult {
  items: RedemptionHistoryEntryDto[];
  total: number;
  monthSummaryRows: HistoryRowForSummary[];
}

export interface MyVouchersReadPort {
  /**
   * Lists tickets of a user sorted by expiresAt ASC.
   * Excludes tickets whose redemption has a redemption_refunds row.
   */
  listTickets(userId: string, now: number): Promise<TicketListResult>;

  /**
   * Finds a single ticket of a user by redemption ID.
   * If not found or belongs to another user, returns null.
   * Returns even if refunded (so the UI deep link can show its refund status).
   */
  findTicket(
    userId: string,
    redemptionId: string,
    now: number,
  ): Promise<TicketDetailResult | null>;

  /**
   * Lists history entries of a user: union of SUCCEEDED, FAILED, and REFUNDED.
   * Sorted newest first (createdAt DESC).
   * Also returns rows needed for monthSummary.
   */
  listHistory(
    userId: string,
    limit: number,
    offset: number,
    now?: number,
  ): Promise<RedemptionHistoryListResult>;
}
