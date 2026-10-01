/**
 * Plan 5.4: persistence of single-use password reset tokens
 * (`password_reset_tokens`, SHA-256 hex digest only) and the reset itself.
 */
export const PASSWORD_RESET_REPOSITORY_PORT = Symbol(
  'PASSWORD_RESET_REPOSITORY_PORT',
);

export interface IssuePasswordResetToken {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
  /** Tokens created at or after this instant count toward the limit. */
  windowStart: Date;
  maxPerWindow: number;
}

export interface RedeemPasswordResetToken {
  tokenHash: string;
  passwordHash: string;
  now: Date;
}

export interface RedeemedPasswordReset {
  userId: string;
  tokenId: string;
  revokedSessions: number;
}

export interface PasswordResetRepositoryPort {
  /**
   * One transaction, serialized per account: unless `maxPerWindow` tokens
   * were already issued since `windowStart` (then null), stores the new one
   * (older unused tokens stay valid) and appends the
   * `PASSWORD_RESET_REQUESTED` audit record.
   */
  issue(input: IssuePasswordResetToken): Promise<{ tokenId: string } | null>;

  /** The unused, unexpired token of an ACTIVE account, else null. */
  findValid(
    tokenHash: string,
    now: Date,
  ): Promise<{ tokenId: string; userId: string } | null>;

  /**
   * One transaction: consumes the token (compare-and-set, so one of two
   * concurrent redemptions wins), invalidates the account's other unused
   * tokens, sets the password hash, revokes every session with reason
   * `PASSWORD_RESET` and appends `PASSWORD_RESET_COMPLETED`. Null when the
   * token is unknown, used, expired or its account is not ACTIVE.
   */
  redeem(
    input: RedeemPasswordResetToken,
  ): Promise<RedeemedPasswordReset | null>;

  /**
   * Review L9: deletes up to `limit` tokens used or expired before `cutoff`.
   * Returns how many were deleted.
   */
  purgeBefore(cutoff: Date, limit: number): Promise<number>;
}
