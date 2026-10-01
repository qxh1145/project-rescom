import { internalRewardRequestedPayloadSchema } from '@rescom/schemas';
import {
  OutboxEnvelope,
  OutboxHandler,
  OutboxPayloadInvalidError,
} from '../../../../common/scheduler/outbox/outbox-handler';
import { RewardSettlementCoordinator } from '../../application/reward-settlement.coordinator';

const REWARDABLE_RESPONSE_STATUSES = ['SUBMITTED', 'VALIDATED'];

export const INTERNAL_REWARD_SETTLEMENT_HANDLER =
  'economy.internal-reward-settlement';

/**
 * Story IR.2b Task 5 (AC6; closes Epic 5 DF1 for rewards): the durable
 * recovery path of an Internal reward. The submit path still settles
 * synchronously after its commit (rewards stay instant); this handler settles
 * from the pinned `InternalRewardRequested` request when that did not happen
 * (crash, failure), with the same mapping as the Admin re-drive.
 *
 * Kind (a), PostgreSQL-local: it runs inside the dispatcher's transaction, so
 * the journal, the `processed_handlers` row and PROCESSED commit together.
 * Idempotent: an already-posted settlement (`internal-reward:{responseId}`,
 * e.g. every event written before the dispatcher existed) is a no-op that
 * publishes nothing; otherwise the journal key makes a replay a no-op and
 * `REWARD_EARNED` (dedupe = the journal key) is flushed after commit.
 * A zero reward or a guest settles as a recorded no-credit handling.
 * Review LOW-15: before paying it re-reads the Response through
 * Participation's read; one no longer SUBMITTED/VALIDATED (disputed,
 * rejected) or missing is skipped — recorded as handled, nothing paid.
 */
export class InternalRewardRequestedHandler implements OutboxHandler {
  readonly name = INTERNAL_REWARD_SETTLEMENT_HANDLER;
  readonly eventType = 'InternalRewardRequested';
  readonly schemaVersions = [1];

  constructor(
    private readonly coordinator: Pick<
      RewardSettlementCoordinator,
      'findInternalSettlement' | 'settleInternalReward'
    >,
    /** Participation's Response read (registered by Participation). */
    private readonly responses: {
      findResponseById(id: string): Promise<{ status: string } | null>;
    },
  ) {}

  async handle(event: OutboxEnvelope): Promise<void> {
    const parsed = internalRewardRequestedPayloadSchema.safeParse(
      event.payload,
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new OutboxPayloadInvalidError(
        event.eventType,
        issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid',
      );
    }
    const payload = parsed.data;
    if (await this.coordinator.findInternalSettlement(payload.responseId)) {
      return;
    }
    const response = await this.responses.findResponseById(payload.responseId);
    if (!response || !REWARDABLE_RESPONSE_STATUSES.includes(response.status)) {
      return;
    }
    await this.coordinator.settleInternalReward({
      responseId: payload.responseId,
      publisherId: payload.publisherId,
      respondentId: payload.respondentId,
      rewardPerResponse: payload.rewardAmount,
      policyMode: payload.policyMode,
    });
  }
}
