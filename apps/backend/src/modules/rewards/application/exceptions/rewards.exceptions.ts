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
  | 'STOCK_EXCEEDS_CODES'
  | 'QUOTE_NOT_FOUND'
  | 'QUOTE_ALREADY_REDEEMED'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'REDEMPTION_NOT_FOUND'
  | 'SOLD_OUT'
  | 'PRICE_CHANGED'
  | 'INSUFFICIENT_POINTS'
  | 'VOUCHER_UNAVAILABLE'
  | 'ACCOUNT_NOT_ELIGIBLE';

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

export class RedemptionRejectionException extends Error {
  constructor(
    readonly code:
      | 'SOLD_OUT'
      | 'PRICE_CHANGED'
      | 'INSUFFICIENT_POINTS'
      | 'VOUCHER_UNAVAILABLE'
      | 'ACCOUNT_NOT_ELIGIBLE',
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RedemptionRejectionException';
  }
}

/** A stored FAILED attempt answered again: must not be recorded a second time. */
export class ReplayedRedemptionRejectionException extends RedemptionRejectionException {
  constructor(
    code: RedemptionRejectionException['code'],
    details: Record<string, unknown>,
  ) {
    super(code, 'Redemption failed', details);
    this.name = 'ReplayedRedemptionRejectionException';
  }
}

export class QuoteNotFoundException extends RewardsException {
  constructor(quoteId: string) {
    super('QUOTE_NOT_FOUND', `Quote ${quoteId} not found`);
    this.name = 'QuoteNotFoundException';
  }
}

export class QuoteAlreadyRedeemedException extends RewardsException {
  constructor(quoteId: string) {
    super(
      'QUOTE_ALREADY_REDEEMED',
      `Quote ${quoteId} has already been redeemed`,
    );
    this.name = 'QuoteAlreadyRedeemedException';
  }
}

export class IdempotencyKeyConflictException extends RewardsException {
  constructor(key: string) {
    super(
      'IDEMPOTENCY_KEY_CONFLICT',
      `Idempotency key ${key} already exists with different transaction parameters`,
    );
    this.name = 'IdempotencyKeyConflictException';
  }
}

export class RedemptionNotFoundException extends RewardsException {
  constructor(key: string) {
    super('REDEMPTION_NOT_FOUND', `Redemption with key ${key} not found`);
    this.name = 'RedemptionNotFoundException';
  }
}
