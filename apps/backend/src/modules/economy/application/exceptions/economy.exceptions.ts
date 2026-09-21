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
  readonly code = 'INSUFFICIENT_BALANCE';

  constructor(
    message = 'Transaction rejected: account balance is insufficient and cannot overdraft.',
  ) {
    super(message);
    this.name = 'InsufficientBalanceException';
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
