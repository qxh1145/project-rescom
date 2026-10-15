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
  | 'ACCOUNT_NOT_ELIGIBLE'
  | 'FLASH_SALE_NOT_FOUND'
  | 'FLASH_STARTS_IN_PAST'
  | 'VOUCHER_NOT_FLASHABLE'
  | 'FLASH_PRICE_NOT_BELOW_REGULAR'
  | 'FLASH_QUOTA_EXCEEDS_STOCK'
  | 'FLASH_OVERLAP'
  | 'FLASH_ALREADY_STARTED'
  | 'FLASH_NOT_ACTIVE'
  | 'FLASH_ALREADY_ENDED'
  | 'FLASH_CODE_EXHAUSTED'
  | 'TICKET_NOT_FOUND'
  | 'TICKET_EXPIRED'
  | 'UNDO_WINDOW_CLOSED'
  | 'CODE_ISSUE_ALREADY_OPEN'
  | 'TICKET_REFUNDED'
  | 'CODE_ISSUE_NOT_FOUND'
  | 'CODE_ISSUE_ALREADY_RESOLVED'
  | 'NO_REPLACEMENT_AVAILABLE'
  | 'REPLACEMENT_NOT_SUPPORTED';

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

export class TicketNotFoundException extends RewardsException {
  constructor(id: string) {
    super('TICKET_NOT_FOUND', `Ticket ${id} not found`);
    this.name = 'TicketNotFoundException';
  }
}

export class TicketExpiredException extends RewardsException {
  constructor(message = 'Voucher đã hết hạn') {
    super('TICKET_EXPIRED', message);
    this.name = 'TicketExpiredException';
  }
}

export class UndoWindowClosedException extends RewardsException {
  constructor(message = 'Đã quá thời hạn 24 giờ để hoàn tác') {
    super('UNDO_WINDOW_CLOSED', message);
    this.name = 'UndoWindowClosedException';
  }
}

export class CodeIssueAlreadyOpenException extends RewardsException {
  constructor(message = 'Vé đã có một khiếu nại đang được xử lý') {
    super('CODE_ISSUE_ALREADY_OPEN', message);
    this.name = 'CodeIssueAlreadyOpenException';
  }
}

export class TicketRefundedException extends RewardsException {
  constructor(message = 'Vé đã được hoàn tiền') {
    super('TICKET_REFUNDED', message);
    this.name = 'TicketRefundedException';
  }
}

export class CodeIssueNotFoundException extends RewardsException {
  constructor(id: string) {
    super('CODE_ISSUE_NOT_FOUND', `Code issue ${id} not found`);
    this.name = 'CodeIssueNotFoundException';
  }
}

export class CodeIssueAlreadyResolvedException extends RewardsException {
  constructor(message = 'Khiếu nại đã được giải quyết') {
    super('CODE_ISSUE_ALREADY_RESOLVED', message);
    this.name = 'CodeIssueAlreadyResolvedException';
  }
}

export class NoReplacementAvailableException extends RewardsException {
  constructor(message = 'Không còn mã thay thế khả dụng') {
    super('NO_REPLACEMENT_AVAILABLE', message);
    this.name = 'NoReplacementAvailableException';
  }
}

export class ReplacementNotSupportedException extends RewardsException {
  constructor(message = 'Voucher dùng mã chung không hỗ trợ đổi mã') {
    super('REPLACEMENT_NOT_SUPPORTED', message);
    this.name = 'ReplacementNotSupportedException';
  }
}
