import type { VoucherCategory, VoucherBrandDto } from '@rescom/schemas';

export const VOUCHER_REPOSITORY_PORT = Symbol('VOUCHER_REPOSITORY_PORT');
export interface VoucherRecord {
  id: string;
  title: string;
  brand: VoucherBrandDto;
  category: VoucherCategory;
  valueVnd: number;
  basePoints: number;
  promoPoints: number | null;
  priceVersion: number;
  stockTotal: number;
  stockRemaining: number;
  codesAvailable: number;
  state: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  isVisible: boolean;
  isSharedCode: boolean;
  sharedCode: string | null;
  redeemStartsAt: string;
  redeemEndsAt: string;
  codeExpiresAt: string;
  description: string | null;
  whereToUse: string | null;
  terms: string[];
  howToUse: string[];
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string;
}
export interface VoucherPriceVersionRecord {
  version: number;
  basePoints: number;
  promoPoints: number | null;
  effectiveFrom: string;
  changedBy: { id: string; name: string };
}
export interface VoucherRedemptionRecord {
  reference: string;
  userId: string;
  points: number;
  kind: 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  createdAt: string;
}
export interface RewardsAuditEvent {
  id: string;
  idempotencyKey: string;
  eventType: string;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  payload: Record<string, unknown>;
}
export interface VoucherRepositoryPort {
  /** Serialize writes to one voucher under the ambient transaction. */
  lock(id: string): Promise<void>;
  list(): Promise<VoucherRecord[]>;
  findById(id: string): Promise<VoucherRecord | null>;
  listBrands(): Promise<VoucherBrandDto[]>;
  create(voucher: VoucherRecord): Promise<VoucherRecord>;
  save(voucher: VoucherRecord): Promise<VoucherRecord>;
  /** Atomic conditional update; null means stock changed or committed stock exceeds total. */
  adjustStock(
    id: string,
    total: number,
    expectedRemaining: number,
    updatedAt: string,
  ): Promise<VoucherRecord | null>;
  appendPriceVersion(
    voucherId: string,
    version: number,
    basePoints: number,
    promoPoints: number | null,
    changedById: string,
    effectiveFrom: string,
  ): Promise<void>;
  priceHistory(voucherId: string): Promise<VoucherPriceVersionRecord[]>;
  redemptions(
    voucherId: string,
    limit: number,
  ): Promise<VoucherRedemptionRecord[]>;
  /** Conditional decrement: decrements stockRemaining iff stockRemaining > 0. Returns true if updated. */
  decrementRegularStock(id: string, updatedAt: string): Promise<boolean>;
  appendAudit(event: RewardsAuditEvent): Promise<void>;
}
