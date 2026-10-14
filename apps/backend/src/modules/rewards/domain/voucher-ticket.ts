import {
  VoucherTicketDto,
  VoucherTicketStatus,
  VoucherPriceSource,
} from '@rescom/schemas';
import { VoucherRecord } from '../application/ports/voucher-repository.port';

export interface RedemptionRecordForTicket {
  id: string;
  reference: string;
  pricePoints: number;
  priceSource: VoucherPriceSource;
  createdAt: string | Date;
}

/**
 * Ticket status computation matching mock:
 * - EXPIRED: remaining <= 0
 * - EXPIRING: remaining <= 7 days
 * - UNUSED: otherwise
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
 * Pure function to construct VoucherTicketDto (Task 3.4).
 * Ticket ID is the redemption ID (1:1 mapping).
 */
export function toVoucherTicket(
  redemption: RedemptionRecordForTicket,
  voucher: VoucherRecord,
  code: string,
  now: number,
): VoucherTicketDto {
  const expiresAt = voucher.codeExpiresAt;
  const status = calculateTicketStatus(expiresAt, null, now);
  const redeemedAt = new Date(redemption.createdAt).toISOString();
  const expiresAtIso = new Date(expiresAt).toISOString();

  return {
    id: redemption.id,
    redemptionId: redemption.id,
    reference: redemption.reference,
    voucherId: voucher.id,
    title: voucher.title,
    brand: voucher.brand,
    category: voucher.category,
    valueVnd: voucher.valueVnd,
    code,
    isSharedCode: voucher.isSharedCode,
    status,
    redeemedAt,
    expiresAt: expiresAtIso,
    usedAt: null,
    undoUntil: null,
    pointsSpent: redemption.pricePoints,
    priceSource: redemption.priceSource,
    howToUse: voucher.howToUse,
    openIssue: null,
  };
}
