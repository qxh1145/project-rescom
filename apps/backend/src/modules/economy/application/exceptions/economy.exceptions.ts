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
