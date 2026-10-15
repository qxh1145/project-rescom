import {
  VoucherRecord,
  VoucherRedemptionRecord,
  VoucherRepositoryPort,
  VoucherPriceVersionRecord,
  RewardsAuditEvent,
} from '../application/ports/voucher-repository.port';

export class InMemoryVoucherRepository implements VoucherRepositoryPort {
  readonly vouchers = new Map<string, VoucherRecord>();
  readonly brands = new Map<string, { id: string; name: string }>();
  readonly versions = new Map<string, VoucherPriceVersionRecord[]>();
  readonly audits: RewardsAuditEvent[] = [];
  async lock(_id: string): Promise<void> {}
  async list(): Promise<VoucherRecord[]> {
    return [...this.vouchers.values()].map((row) => structuredClone(row));
  }
  async findById(id: string): Promise<VoucherRecord | null> {
    return structuredClone(this.vouchers.get(id) ?? null);
  }
  async listBrands() {
    return [...this.brands.values()].map((row) => ({ ...row }));
  }
  async create(voucher: VoucherRecord) {
    this.vouchers.set(voucher.id, structuredClone(voucher));
    return structuredClone(voucher);
  }
  async save(voucher: VoucherRecord) {
    this.vouchers.set(voucher.id, structuredClone(voucher));
    return structuredClone(voucher);
  }
  async adjustStock(
    id: string,
    total: number,
    expectedRemaining: number,
    updatedAt: string,
  ) {
    const row = this.vouchers.get(id);
    if (
      !row ||
      row.stockRemaining !== expectedRemaining ||
      total < 0 ||
      row.stockRemaining + total - row.stockTotal < 0
    )
      return null;
    const changed = {
      ...row,
      stockTotal: total,
      stockRemaining: row.stockRemaining + total - row.stockTotal,
      updatedAt,
    };
    this.vouchers.set(id, changed);
    return structuredClone(changed);
  }
  async appendPriceVersion(
    voucherId: string,
    version: number,
    basePoints: number,
    promoPoints: number | null,
    changedById: string,
    effectiveFrom: string,
  ): Promise<void> {
    this.versions.set(voucherId, [
      ...(this.versions.get(voucherId) ?? []),
      {
        version,
        basePoints,
        promoPoints,
        effectiveFrom,
        changedBy: { id: changedById, name: 'Admin' },
      },
    ]);
  }
  async priceHistory(voucherId: string): Promise<VoucherPriceVersionRecord[]> {
    return structuredClone(this.versions.get(voucherId) ?? []);
  }
  async redemptions(
    _voucherId: string,
    _limit: number,
  ): Promise<VoucherRedemptionRecord[]> {
    return [];
  }
  async decrementRegularStock(id: string, updatedAt: string): Promise<boolean> {
    const v = this.vouchers.get(id);
    if (!v || v.stockRemaining <= 0) return false;
    v.stockRemaining -= 1;
    v.updatedAt = updatedAt;
    return true;
  }
  async appendAudit(event: RewardsAuditEvent): Promise<void> {
    this.audits.push(structuredClone(event));
  }
}
