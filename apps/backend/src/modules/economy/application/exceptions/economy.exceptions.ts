export class UnbalancedJournalException extends Error {
  readonly code = 'JOURNAL_UNBALANCED';

  constructor(
    message = 'Ledger journal entries must balance to zero and contain at least two entries.',
  ) {
    super(message);
    this.name = 'UnbalancedJournalException';
  }
}

export class InsufficientBalanceException extends Error {
  readonly code: string = 'INSUFFICIENT_BALANCE';

  constructor(
    message = 'Transaction rejected: account balance is insufficient and cannot overdraft.',
  ) {
    super(message);
    this.name = 'InsufficientBalanceException';
  }
}

export class InsufficientEscrowBalanceException extends InsufficientBalanceException {
  override readonly code: string = 'INSUFFICIENT_ESCROW_BALANCE';

  constructor(
    public readonly availableBalance: number,
    public readonly requiredAmount: number,
    message?: string,
    public readonly refundHoldPoints?: number,
  ) {
    super(
      message ??
        `Insufficient points: Survey publishing requires ${requiredAmount} points in Escrow, but available balance is only ${availableBalance} points. Please earn or top up points before publishing.`,
    );
    this.name = 'InsufficientEscrowBalanceException';
  }
}

export class AccountNotFoundException extends Error {
  readonly code = 'ACCOUNT_NOT_FOUND';

  constructor(message = 'The specified ledger account was not found.') {
    super(message);
    this.name = 'AccountNotFoundException';
  }
}

export class JournalNotFoundException extends Error {
  readonly code = 'JOURNAL_NOT_FOUND';

  constructor(message = 'The specified ledger journal was not found.') {
    super(message);
    this.name = 'JournalNotFoundException';
  }
}

export class JournalAlreadyReversedException extends Error {
  readonly code = 'JOURNAL_ALREADY_REVERSED';

  constructor(
    message = 'The specified ledger journal has already been reversed and cannot be reversed again.',
  ) {
    super(message);
    this.name = 'JournalAlreadyReversedException';
  }
}

export class IdempotencyConflictException extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(
    message = 'A ledger journal with this idempotency key already exists with conflicting transaction parameters.',
  ) {
    super(message);
    this.name = 'IdempotencyConflictException';
  }
}

export class InvalidLedgerOperationException extends Error {
  readonly code = 'INVALID_LEDGER_OPERATION';

  constructor(message = 'Invalid ledger operation.') {
    super(message);
    this.name = 'InvalidLedgerOperationException';
  }
}

export class DisputeHoldActiveException extends Error {
  readonly code = 'DISPUTE_HOLD_ACTIVE';

  constructor(
    public readonly attemptId: string,
    message?: string,
  ) {
    super(
      message ??
        `Cannot release pending reward for attempt "${attemptId}": An active dispute hold is currently locked.`,
    );
    this.name = 'DisputeHoldActiveException';
  }
}

/**
 * A journal cannot be reversed while a later journal that depends on it
 * (e.g. the Pending release or a dispute hold of an External completion
 * credit) stands unreversed: the negation would drain points that other
 * credits pooled in the same account still back. Reverse the downstream
 * journal first. Symmetrically, a reversal cannot be undone (re-instating its
 * original journal) while the journal the original was built on is reversed.
 */
export class DownstreamJournalExistsException extends Error {
  readonly code = 'LEDGER_DOWNSTREAM_JOURNAL_EXISTS';

  constructor(
    public readonly targetIdempotencyKey: string,
    public readonly blockingIdempotencyKey: string,
    message?: string,
  ) {
    super(
      message ??
        `Journal "${targetIdempotencyKey}" cannot be reversed while the dependent journal "${blockingIdempotencyKey}" is not reversed. Reverse the dependent journal first.`,
    );
    this.name = 'DownstreamJournalExistsException';
  }
}

/**
 * Epic 6 review P14: a concurrent command posted the same idempotency key
 * while this one ran inside a shared Unit of Work. PostgreSQL aborted the
 * whole transaction, so the caller cannot converge on the winner; it must
 * retry (the retry then takes the idempotent fast path).
 */
export class ConcurrentLedgerCommandException extends Error {
  readonly code = 'LEDGER_COMMAND_IN_PROGRESS';

  constructor(
    public readonly idempotencyKey: string,
    message = 'The same ledger command is already being processed. Please retry.',
  ) {
    super(message);
    this.name = 'ConcurrentLedgerCommandException';
  }
}

/** Epic 6 review P2: no External completion credit exists for this attempt. */
export class PendingCreditNotFoundException extends Error {
  readonly code = 'PENDING_CREDIT_NOT_FOUND';

  constructor(
    public readonly attemptId: string,
    message = 'No pending reward credit exists for this survey attempt.',
  ) {
    super(message);
    this.name = 'PendingCreditNotFoundException';
  }
}

/** Epic 6 review P2: the 48-hour review window (FR-24) has not elapsed yet. */
export class PendingRewardNotMaturedException extends Error {
  readonly code = 'PENDING_REWARD_NOT_MATURED';

  constructor(
    public readonly attemptId: string,
    public readonly maturesAt: Date,
  ) {
    super(
      'This pending reward is still inside its 48-hour review window and cannot be released yet.',
    );
    this.name = 'PendingRewardNotMaturedException';
  }
}

/** Epic 6 review P2: the pending credit belongs to another respondent. */
export class PendingRewardForbiddenException extends Error {
  readonly code = 'PENDING_REWARD_FORBIDDEN';

  constructor(message = 'You can only release your own pending rewards.') {
    super(message);
    this.name = 'PendingRewardForbiddenException';
  }
}

// ---------------------------------------------------------------------------
// Story 6.6: manual Point top-up (FR-34, FR-35)
// ---------------------------------------------------------------------------

export class InvalidTopUpRequestException extends Error {
  readonly code = 'TOPUP_INVALID_REQUEST';

  constructor(message = 'The top-up request is invalid.') {
    super(message);
    this.name = 'InvalidTopUpRequestException';
  }
}

export class TopUpRequestNotFoundException extends Error {
  readonly code = 'TOPUP_NOT_FOUND';

  constructor(public readonly topUpId: string) {
    super(`Top-up request ${topUpId} was not found.`);
    this.name = 'TopUpRequestNotFoundException';
  }
}

export class TopUpAlreadyReviewedException extends Error {
  readonly code = 'TOPUP_ALREADY_REVIEWED';

  constructor(
    public readonly topUpId: string,
    public readonly currentStatus: string,
  ) {
    super(
      `Top-up request ${topUpId} is already ${currentStatus} and cannot be reviewed again.`,
    );
    this.name = 'TopUpAlreadyReviewedException';
  }
}

export class TopUpPendingLimitExceededException extends Error {
  readonly code = 'TOPUP_PENDING_LIMIT_REACHED';

  constructor(public readonly maxPendingRequests: number) {
    super(
      `You already have ${maxPendingRequests} top-up requests awaiting payment review. Please wait for them to be processed before creating another.`,
    );
    this.name = 'TopUpPendingLimitExceededException';
  }
}

export class TopUpReferenceConflictException extends Error {
  readonly code = 'TOPUP_REFERENCE_CONFLICT';

  constructor(
    message = 'Could not allocate a unique transfer reference. Please try again.',
  ) {
    super(message);
    this.name = 'TopUpReferenceConflictException';
  }
}

export class TopUpAdminCapabilityRequiredException extends Error {
  readonly code = 'TOPUP_ADMIN_CAPABILITY_REQUIRED';

  constructor(
    message = 'Only an active administrator can review top-up requests.',
  ) {
    super(message);
    this.name = 'TopUpAdminCapabilityRequiredException';
  }
}

export class TopUpSelfReviewForbiddenException extends Error {
  readonly code = 'TOPUP_SELF_REVIEW_FORBIDDEN';

  constructor(
    message = 'Administrators cannot review their own top-up requests.',
  ) {
    super(message);
    this.name = 'TopUpSelfReviewForbiddenException';
  }
}

export class PayosTopUpAlreadyProcessingException extends Error {
  readonly code = 'TOPUP_ALREADY_PROCESSING';
  constructor(
    public readonly topUpId: string,
    public readonly checkoutUrl: string | null,
  ) {
    super('A top-up is already processing.');
  }
}
export class PayosCheckoutRateLimitedException extends Error {
  readonly code = 'TOPUP_CHECKOUT_RATE_LIMITED';
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many top-up checkouts.');
  }
}
export class PayosCheckoutUnavailableException extends Error {
  readonly code = 'TOPUP_PROVIDER_UNAVAILABLE';
  constructor() {
    super('Top-up checkout is temporarily unavailable. Please retry.');
  }
}
export class PayosTopUpNotCancellableException extends Error {
  readonly code = 'TOPUP_NOT_CANCELLABLE';
  constructor(public readonly currentStatus: string) {
    super('Top-up cannot be cancelled.');
  }
}

export class TopUpExportTooLargeException extends Error {
  readonly code = 'TOPUP_EXPORT_TOO_LARGE';
  constructor(public readonly maxRows: number) {
    super(`Top-up export exceeds ${maxRows} rows.`);
  }
}

export class TopUpMismatchAlreadyResolvedException extends Error {
  readonly code = 'TOPUP_MISMATCH_ALREADY_RESOLVED';
  constructor(public readonly status: string) {
    super('Top-up mismatch already resolved.');
  }
}
export class TopUpMismatchAmountChangedException extends Error {
  readonly code = 'TOPUP_MISMATCH_AMOUNT_CHANGED';
  constructor(public readonly amountPaidVnd: number | null) {
    super('Paid amount changed.');
  }
}
export class TopUpMismatchNothingToCreditException extends Error {
  readonly code = 'TOPUP_MISMATCH_NOTHING_TO_CREDIT';
  constructor() {
    super('Paid amount is below one Point.');
  }
}

export class TopUpRefundNotAllowedException extends Error {
  readonly code = 'TOPUP_REFUND_NOT_ALLOWED';
  readonly status = 409;
  constructor(public readonly reason: string) {
    super(`Top-up refund not allowed: ${reason}`);
    this.name = 'TopUpRefundNotAllowedException';
  }
}

export class TopUpRefundAlreadyRequestedException extends Error {
  readonly code = 'TOPUP_REFUND_ALREADY_REQUESTED';
  readonly status = 409;
  constructor() {
    super('Top-up refund already requested.');
    this.name = 'TopUpRefundAlreadyRequestedException';
  }
}

export class TopUpRefundNotFoundException extends Error {
  readonly code = 'TOPUP_REFUND_NOT_FOUND';
  readonly status = 404;
  constructor(message?: string) {
    super(
      message
        ? `Top-up refund request not found: ${message}`
        : 'Top-up refund request not found.',
    );
    this.name = 'TopUpRefundNotFoundException';
  }
}

export class RefundAlreadyResolvedException extends Error {
  readonly code = 'REFUND_ALREADY_RESOLVED';
  readonly status = 409;
  constructor() {
    super('Refund already resolved.');
    this.name = 'RefundAlreadyResolvedException';
  }
}

export class RefundNotHeldException extends Error {
  readonly code = 'REFUND_NOT_HELD';
  readonly status = 409;
  constructor(message = 'Refund hold not active or points held is zero.') {
    super(message);
    this.name = 'RefundNotHeldException';
  }
}

export class RefundDestinationUnconfirmedException extends Error {
  readonly code = 'REFUND_DESTINATION_UNCONFIRMED';
  readonly status = 409;
  constructor(
    message = 'Admin must confirm destination account before marking as refunded.',
  ) {
    super(message);
    this.name = 'RefundDestinationUnconfirmedException';
  }
}

export class RefundNotRefundedException extends Error {
  readonly code = 'REFUND_NOT_REFUNDED';
  readonly status = 409;
  constructor(
    message = 'Refund request must be in REFUNDED status to record bank transfer.',
  ) {
    super(message);
    this.name = 'RefundNotRefundedException';
  }
}

export class RefundBankTransferAlreadyRecordedException extends Error {
  readonly code = 'REFUND_BANK_TRANSFER_ALREADY_RECORDED';
  readonly status = 409;
  constructor(
    message = 'Bank transfer has already been recorded for this refund request.',
  ) {
    super(message);
    this.name = 'RefundBankTransferAlreadyRecordedException';
  }
}

export class RefundResolutionValidationException extends Error {
  readonly code = 'VALIDATION_ERROR';
  readonly status = 400;
  constructor(
    message: string,
    readonly details: { path: string; code: string }[],
  ) {
    super(message);
    this.name = 'RefundResolutionValidationException';
  }
}

// ---------------------------------------------------------------------------
// Story 14.5: Admin Direct Point Credit
// ---------------------------------------------------------------------------

export class AdminSelfCreditForbiddenException extends Error {
  readonly code = 'ADMIN_SELF_CREDIT_FORBIDDEN';
  readonly status = 403;
  constructor(
    message = 'Administrators cannot credit points to their own account.',
  ) {
    super(message);
    this.name = 'AdminSelfCreditForbiddenException';
  }
}

export class UserBannedException extends Error {
  readonly code = 'USER_BANNED';
  readonly status = 409;
  constructor(
    message = 'Target user is locked and cannot receive point credits.',
  ) {
    super(message);
    this.name = 'UserBannedException';
  }
}

export class AdminPointCreditCapabilityRequiredException extends Error {
  readonly code = 'ADMIN_CAPABILITY_REQUIRED';
  readonly status = 403;
  constructor(message = 'Only an active administrator can credit points.') {
    super(message);
    this.name = 'AdminPointCreditCapabilityRequiredException';
  }
}
