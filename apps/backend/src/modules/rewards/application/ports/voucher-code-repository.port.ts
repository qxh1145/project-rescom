export const VOUCHER_CODE_REPOSITORY_PORT = Symbol(
  'VOUCHER_CODE_REPOSITORY_PORT',
);
export interface VoucherCodeRepositoryPort {
  listCodes(voucherId: string): Promise<string[]>;
  countAvailable(voucherId: string): Promise<number>;
  /** All-or-nothing insertion; caller owns ambient transaction. */
  importCodes(voucherId: string, codes: string[]): Promise<void>;
  /** Remove only unassigned codes; returns rows removed. Caller owns ambient transaction. */
  removeAvailable(voucherId: string, count: number): Promise<number>;
  hasIssued(voucherId: string): Promise<boolean>;
}
