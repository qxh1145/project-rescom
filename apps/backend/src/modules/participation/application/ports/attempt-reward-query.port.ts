import type {
  ActivationSurveyDto,
  RewardSettlementResultDto,
} from '@rescom/schemas';

/**
 * Where the External completion credit of an attempt stands, refined by its
 * dispute journals: `HELD` = an open dispute hold, `REFUNDED_TO_PUBLISHER` =
 * a dispute resolved for the Publisher; a resolution for the Respondent reads
 * `RELEASED`. Implemented by Economy (`getExternalSettlementState`).
 */
export type ExternalSettlementStateValue =
  | 'NONE'
  | 'PENDING'
  | 'RELEASED'
  | 'REVERSED'
  | 'HELD'
  | 'REFUNDED_TO_PUBLISHER';

/** The account's starter unlock and the survey it is attributed to. */
export interface AttemptActivationSnapshot {
  unlockedAt: Date | null;
  amount: number | null;
  activationSurvey: ActivationSurveyDto | null;
}

/**
 * Story IR.2a (AD-16): the Economy-owned, read-only queries behind
 * `GET /attempts/:attemptId/outcome`. Implemented by adapting
 * `RewardSettlementCoordinator` and `StarterPointsCoordinator`; Participation
 * never reads ledger tables or posts journals through it.
 */
export interface AttemptRewardQueryPort {
  /** The posted `internal-reward:` / `integrity-hold:` settlement of a response, or null. */
  findInternalSettlement(
    responseId: string,
  ): Promise<RewardSettlementResultDto | null>;
  /** The posted `external-completion:` credit of an attempt, or null. */
  findExternalSettlement(
    attemptId: string,
  ): Promise<RewardSettlementResultDto | null>;
  getExternalSettlementState(
    attemptId: string,
  ): Promise<ExternalSettlementStateValue>;
  getActivationSnapshot(userId: string): Promise<AttemptActivationSnapshot>;
}
