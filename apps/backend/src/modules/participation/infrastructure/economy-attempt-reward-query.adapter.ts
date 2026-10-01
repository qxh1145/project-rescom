import type { RewardSettlementCoordinator } from '../../economy/application/reward-settlement.coordinator';
import type { StarterPointsCoordinator } from '../../economy/application/starter-points.coordinator';
import {
  AttemptActivationSnapshot,
  AttemptRewardQueryPort,
} from '../application/ports/attempt-reward-query.port';

const NO_ACTIVATION: AttemptActivationSnapshot = Object.freeze({
  unlockedAt: null,
  amount: null,
  activationSurvey: null,
});

/**
 * Story IR.2a (AD-16): Economy's read-only queries behind the Participation
 * port of `GET /attempts/:attemptId/outcome`. Only lookups are exposed — no
 * settle, re-drive, release, unlock or notification method is reachable.
 * Without a StarterPointsCoordinator no account reads as activated.
 */
export function economyAttemptRewardQueries(
  rewardSettlement: Pick<
    RewardSettlementCoordinator,
    | 'findInternalSettlement'
    | 'findExternalSettlement'
    | 'getExternalSettlementState'
  >,
  starterPoints?: Pick<StarterPointsCoordinator, 'getActivationSnapshot'>,
): AttemptRewardQueryPort {
  return {
    findInternalSettlement: (responseId) =>
      rewardSettlement.findInternalSettlement(responseId),
    findExternalSettlement: (attemptId) =>
      rewardSettlement.findExternalSettlement(attemptId),
    getExternalSettlementState: (attemptId) =>
      rewardSettlement.getExternalSettlementState(attemptId),
    getActivationSnapshot: async (userId) =>
      starterPoints
        ? starterPoints.getActivationSnapshot(userId)
        : NO_ACTIVATION,
  };
}
