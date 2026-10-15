import {
  VoucherTicketDto,
  VoucherPriceSource,
  CodeIssueStatus,
} from '@rescom/schemas';
import { VoucherRecord } from '../application/ports/voucher-repository.port';
import { calculateTicketStatus } from './ticket-rules';

export { calculateTicketStatus };

export interface RedemptionRecordForTicket {
  id: string;
  reference: string;
  pricePoints: number;
  priceSource: VoucherPriceSource;
  createdAt: string | Date;
}

export interface TicketOptionalFacts {
  usage?: { usedAt: string | Date; undoUntil: string | Date } | null;
  latestIssue?: { id: string; status: CodeIssueStatus } | null;
  replacementCode?: string | null;
}

/**
 * Pure function to construct VoucherTicketDto (Tasks 2.2, 3.4).
 * Ticket ID is the redemption ID (1:1 mapping).
 * When optional facts are provided:
 * - code resolves to replacementCode if present, else original code
 * - usedAt, undoUntil come from usage
 * - status reflects usage and expiry
 * - openIssue reflects latest issue
 */
export function toVoucherTicket(
  redemption: RedemptionRecordForTicket,
  voucher: VoucherRecord,
  code: string,
  now: number,
  facts?: TicketOptionalFacts,
): VoucherTicketDto {
  const expiresAt = voucher.codeExpiresAt;
  const usedAt = facts?.usage?.usedAt
    ? new Date(facts.usage.usedAt).toISOString()
    : null;
  const undoUntil = facts?.usage?.undoUntil
    ? new Date(facts.usage.undoUntil).toISOString()
    : null;
  const status = calculateTicketStatus(expiresAt, usedAt, now);
  const redeemedAt = new Date(redemption.createdAt).toISOString();
  const expiresAtIso = new Date(expiresAt).toISOString();
  const effectiveCode = facts?.replacementCode ?? code;

  return {
    id: redemption.id,
    redemptionId: redemption.id,
    reference: redemption.reference,
    voucherId: voucher.id,
    title: voucher.title,
    brand: voucher.brand,
    category: voucher.category,
    valueVnd: voucher.valueVnd,
    code: effectiveCode,
    isSharedCode: voucher.isSharedCode,
    status,
    redeemedAt,
    expiresAt: expiresAtIso,
    usedAt,
    undoUntil,
    pointsSpent: redemption.pricePoints,
    priceSource: redemption.priceSource,
    howToUse: voucher.howToUse,
    openIssue: facts?.latestIssue
      ? { id: facts.latestIssue.id, status: facts.latestIssue.status }
      : null,
  };
}
