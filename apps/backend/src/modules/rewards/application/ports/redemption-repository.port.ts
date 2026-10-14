import { VoucherPriceSource } from '@rescom/schemas';

export type RedemptionStatus = 'SUCCEEDED' | 'FAILED' | 'REFUNDED';

export const REDEMPTION_REPOSITORY_PORT = Symbol('REDEMPTION_REPOSITORY_PORT');

export interface RedemptionQuoteRecord {
  id: string;
  userId: string;
  voucherId: string;
  flashSaleItemId: string | null;
  priceVersion: number;
  pricePoints: number;
  priceSource: VoucherPriceSource;
  expiresAt: string;
  createdAt: string;
}

export interface RedemptionRecord {
  id: string;
  userId: string;
  voucherId: string;
  voucherCodeId: string | null;
  flashSaleItemId: string | null;
  quoteId: string | null;
  idempotencyKey: string;
  status: RedemptionStatus;
  pricePoints: number;
  priceSource: VoucherPriceSource;
  priceVersion: number;
  journalId: string | null;
  balanceAfter: number | null;
  failureCode: string | null;
  failureDetails: Record<string, unknown> | null;
  reference: string;
  createdAt: string;
}

export interface ClaimedVoucherCode {
  id: string;
  code: string;
}

export interface RedemptionRepositoryPort {
  insertQuote(quote: RedemptionQuoteRecord): Promise<RedemptionQuoteRecord>;
  findQuoteById(id: string): Promise<RedemptionQuoteRecord | null>;
  findRedemptionByUserAndKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<RedemptionRecord | null>;
  findSucceededRedemptionByQuoteId(
    quoteId: string,
  ): Promise<RedemptionRecord | null>;
  insertRedemption(redemption: RedemptionRecord): Promise<RedemptionRecord>;
  claimCode(voucherId: string): Promise<ClaimedVoucherCode | null>;
  linkCodeToRedemption(codeId: string, redemptionId: string): Promise<void>;
  countVoucherRedemptionsInWindow(
    userId: string,
    voucherId: string,
    since: Date,
  ): Promise<number>;
  countTodayRedeemedPoints(
    userId: string,
    startOfDay: Date,
    endOfDay: Date,
  ): Promise<number>;
  countFlashItemRedemptionsForUser(
    userId: string,
    flashSaleItemId: string,
  ): Promise<number>;
  getDailyPointsLimit(): Promise<number>;
  setDailyPointsLimit(limit: number, updatedById?: string): Promise<void>;
  findCodeById(id: string): Promise<ClaimedVoucherCode | null>;
}
