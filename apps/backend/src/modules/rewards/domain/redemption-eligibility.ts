import { AccountNotEligibleReason } from '@rescom/schemas';

export interface AccountStandingFacts {
  isActive: boolean;
  isActivated: boolean;
  hasRecentCompletedSurvey: boolean;
  hasBlockingFraudFlag: boolean;
}

export interface FlashEligibilityRules {
  requireRecentSurvey: boolean;
  blockFlagged: boolean;
}

/**
 * Pure eligibility evaluation (Task 4.2):
 * - User not ACTIVE -> ACCOUNT_LOCKED
 * - Not activated (no starter-unlock journal) -> ACCOUNT_NOT_ACTIVATED
 * - For Flash quotes:
 *   - requireRecentSurvey && !hasRecentCompletedSurvey -> NO_RECENT_SURVEY
 *   - blockFlagged && hasBlockingFraudFlag -> FRAUD_FLAGGED
 */
export function checkAccountEligibility(
  standing: AccountStandingFacts,
  flashRules?: FlashEligibilityRules | null,
): AccountNotEligibleReason | null {
  if (!standing.isActive) {
    return 'ACCOUNT_LOCKED';
  }
  if (!standing.isActivated) {
    return 'ACCOUNT_NOT_ACTIVATED';
  }
  if (flashRules) {
    if (flashRules.requireRecentSurvey && !standing.hasRecentCompletedSurvey) {
      return 'NO_RECENT_SURVEY';
    }
    if (flashRules.blockFlagged && standing.hasBlockingFraudFlag) {
      return 'FRAUD_FLAGGED';
    }
  }
  return null;
}
