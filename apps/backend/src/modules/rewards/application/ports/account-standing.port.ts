export const ACCOUNT_STANDING_PORT = Symbol('ACCOUNT_STANDING_PORT');

export interface AccountStandingPort {
  /** Checks if user status is ACTIVE. */
  isActive(userId: string): Promise<boolean>;
  /** Checks if starter-unlock:{userId} journal exists. */
  isActivated(userId: string): Promise<boolean>;
  /** Checks if user completed any survey in last `days` days. */
  completedSurveyInLastDays(
    userId: string,
    days: number,
    now: Date,
  ): Promise<boolean>;
  /** Checks if user has a blocking fraud flag since `since`. FLASH_AFTER_TOPUP does NOT block. */
  hasBlockingFraudFlag(userId: string, since: Date): Promise<boolean>;
  /** Checks if user had an approved top-up since `since`. */
  hasApprovedTopUpSince(userId: string, since: Date): Promise<boolean>;
}

/**
 * Narrow sources of the account facts above. Each is implemented by the module
 * that owns the data (Users: `users.status`, Participation: `survey_attempts` and
 * `fraud_logs`, Economy: journals and top-ups); Rewards composes them into the
 * single `AccountStandingPort` it depends on.
 */
export const ACCOUNT_STATUS_PORT = Symbol('ACCOUNT_STATUS_PORT');
export type AccountStatusPort = Pick<AccountStandingPort, 'isActive'>;

export const SURVEY_COMPLETION_PORT = Symbol('SURVEY_COMPLETION_PORT');
export type SurveyCompletionPort = Pick<
  AccountStandingPort,
  'completedSurveyInLastDays'
>;

export const FRAUD_FLAG_READ_PORT = Symbol('FRAUD_FLAG_READ_PORT');
export type FraudFlagReadPort = Pick<
  AccountStandingPort,
  'hasBlockingFraudFlag'
>;

export const ACCOUNT_FUNDING_PORT = Symbol('ACCOUNT_FUNDING_PORT');
export type AccountFundingPort = Pick<
  AccountStandingPort,
  'isActivated' | 'hasApprovedTopUpSince'
>;
