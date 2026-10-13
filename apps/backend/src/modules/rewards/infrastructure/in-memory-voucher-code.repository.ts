import { VoucherCodeRepositoryPort } from '../application/ports/voucher-code-repository.port';

export class InMemoryVoucherCodeRepository implements VoucherCodeRepositoryPort {
  readonly codes = new Map<string, Set<string>>();
  readonly issued = new Map<string, Set<string>>();
  async listCodes(voucherId: string): Promise<string[]> {
    return [...(this.codes.get(voucherId) ?? [])];
  }
  async countAvailable(voucherId: string): Promise<number> {
    return [...(this.codes.get(voucherId) ?? [])].filter(
      (code) => !this.issued.get(voucherId)?.has(code),
    ).length;
  }
  async importCodes(voucherId: string, codes: string[]): Promise<void> {
    const current = this.codes.get(voucherId) ?? new Set<string>();
    if (
      new Set(codes).size !== codes.length ||
      codes.some((code) => current.has(code))
    )
      throw new Error('Duplicate voucher code');
    this.codes.set(voucherId, new Set([...current, ...codes]));
  }
  async removeAvailable(voucherId: string, count: number): Promise<number> {
    const current = this.codes.get(voucherId);
    if (!current) return 0;
    const removable = [...current]
      .filter((code) => !this.issued.get(voucherId)?.has(code))
      .slice(0, count);
    for (const code of removable) current.delete(code);
    return removable.length;
  }
  async hasIssued(voucherId: string): Promise<boolean> {
    return (this.issued.get(voucherId)?.size ?? 0) > 0;
  }
}
