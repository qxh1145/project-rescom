export type RewardsErrorCode =
  | 'REWARDS_ADMIN_CAPABILITY_REQUIRED'
  | 'VOUCHER_NOT_FOUND'
  | 'BRAND_NOT_FOUND'
  | 'REDEMPTION_WINDOW_ENDED'
  | 'SHARED_CODE_REQUIRED'
  | 'VOUCHER_ARCHIVED'
  | 'SHARED_FLAG_LOCKED'
  | 'SHARED_CODE_VOUCHER'
  | 'STOCK_BELOW_COMMITTED'
  | 'STOCK_INCREASE_NEEDS_CODES'
  | 'STOCK_EXCEEDS_CODES';

export class RewardsException extends Error {
  constructor(
    readonly code: RewardsErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RewardsException';
  }
}
