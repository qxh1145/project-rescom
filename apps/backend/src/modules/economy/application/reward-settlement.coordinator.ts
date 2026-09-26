import { RewardPolicyMode, RewardSettlementResultDto } from '@rescom/schemas';
import {
  attemptIdFromExternalCompletionKey,
  ExternalCreditState,
  LedgerService,
  PENDING_REWARD_MATURITY_MS,
  ReleasePendingRewardParams,
  releasePendingKey,
} from './ledger.service';
import { DisputeHoldActiveException } from './exceptions/economy.exceptions';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import { StarterPointsCoordinator } from './starter-points.coordinator';
import {
  ExternalDisputeHoldQueryPort,
  NoExternalDisputeHolds,
} from './ports/external-dispute-hold-query.port';

/**
 * Dedupe key of the `REWARD_EARNED` notice (decision E9-D2): the ledger
 * idempotency key of the Internal instant credit, so one response notifies
 * at most once whatever path (submit, replay re-drive, Admin re-drive)
 * posted it.
 */
export function internalRewardNotificationKey(responseId: string): string {
  return `internal-reward:${responseId}`;
}

/** AC6.4 scan batch bounds (Epic 6 review P2). */
export const MATURED_RELEASE_DEFAULT_LIMIT = 100;
export const MATURED_RELEASE_MAX_LIMIT = 500;

export type { ExternalCreditState } from './ledger.service';

export interface SettleInternalRewardParams {
  responseId: string;
  publisherId: string;
  respondentId: string | null;
  rewardPerResponse: number;
  policyMode?: RewardPolicyMode;
}

export interface SettleExternalRewardParams {
  attemptId: string;
  publisherId: string;
  respondentId: string;
  rewardPerResponse: number;
}

export interface ReleaseMaturedPendingRewardsParams {
  /** Only credits created at or before it; clamped to now − 48 h. */
  cutoffDate?: Date;
  /** Batch size, 1..500 (default 100). */
  limit?: number;
}

export interface MaturedReleaseSummary {
  processed: number;
  releasedCount: number;
  disputedCount: number;
  failedCount: number;
  /** More matured credits remain after this batch. */
  hasMore: boolean;
  /** The effective (clamped) cutoff, ISO-8601. */
  cutoffDate: string;
}

export class RewardSettlementCoordinator {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly notificationPublisher?: NotificationPublisherPort,
    private readonly starterPoints?: Pick<
      StarterPointsCoordinator,
      'tryUnlockStarterPoints'
    >,
    /** Server-side dispute check (Epic 6 review P2); Phase 1 has none. */
    private readonly disputeHolds: ExternalDisputeHoldQueryPort = new NoExternalDisputeHolds(),
  ) {}

  /**
   * Coordinates settlement for an internal survey completion (FR-29, AD-16).
   * `rewardPerResponse` is the advertised reward, credited in full; the
   * Publisher's Escrow pays only what publish reserved per slot and the
   * platform subsidises the FR-19 discount (decision E6-D1, see
   * `LedgerService.creditInternalReward`).
   *
   * Decision E9-D2 (FR-57 "Points earned"): after an instant credit to the
   * Available balance commits, the respondent is notified (`REWARD_EARNED`,
   * deduplicated on the journal key `internal-reward:{responseId}`). Callers
   * invoke this outside any Unit of Work — the submission's own commit, the
   * respondent's replay re-drive or the Admin re-drive — so the notice always
   * follows the committed journal. Guests, zero-reward surveys and Integrity
   * Holds (ENFORCED) publish nothing.
   */
  async settleInternalReward(
    params: SettleInternalRewardParams,
  ): Promise<RewardSettlementResultDto> {
    const result = await this.creditInternalReward(params);
    await this.notifyRewardEarned(params, result);
    return result;
  }

  private async creditInternalReward(
    params: SettleInternalRewardParams,
  ): Promise<RewardSettlementResultDto> {
    const nowIso = new Date().toISOString();

    if (!params.respondentId) {
      return {
        status: 'SKIPPED_GUEST',
        journalId: null,
        amount: 0,
        targetAccountClass: null,
        settledAt: nowIso,
      };
    }

    if (params.rewardPerResponse <= 0) {
      return {
        status: 'SETTLED',
        journalId: null,
        amount: 0,
        targetAccountClass: null,
        settledAt: nowIso,
      };
    }

    return this.ledgerService.creditInternalReward({
      responseId: params.responseId,
      publisherId: params.publisherId,
      respondentId: params.respondentId,
      amount: params.rewardPerResponse,
      policyMode: params.policyMode,
    });
  }

  /**
   * "Points earned" notice (decision E9-D2). Only an instant credit to
   * `USER_AVAILABLE` qualifies; the amount is the credited total read from the
   * posted journal (the full advertised reward, decision E6-D1). Best-effort
   * (decision E9-D3): a notification failure never changes the settlement.
   */
  private async notifyRewardEarned(
    params: SettleInternalRewardParams,
    result: RewardSettlementResultDto,
  ): Promise<void> {
    if (
      !this.notificationPublisher ||
      !params.respondentId ||
      result.status !== 'SETTLED' ||
      result.targetAccountClass !== 'USER_AVAILABLE' ||
      !result.journalId ||
      result.amount <= 0
    ) {
      return;
    }
    try {
      await this.notificationPublisher.publish({
        userId: params.respondentId,
        type: 'REWARD_EARNED',
        message: `${result.amount} points for your completed internal survey were added to your Available balance.`,
        dedupeKey: internalRewardNotificationKey(params.responseId),
      });
    } catch {
      // The publisher contract is "never throws"; a breach must not turn a
      // committed credit into a failed settlement.
    }
  }

  /**
   * Coordinates settlement for an external survey completion (FR-24, AD-16).
   * Credits points into PENDING account for 48 hours.
   */
  async settleExternalReward(
    params: SettleExternalRewardParams,
  ): Promise<RewardSettlementResultDto> {
    const nowIso = new Date().toISOString();

    if (params.rewardPerResponse <= 0) {
      return {
        status: 'PENDING',
        journalId: null,
        amount: 0,
        targetAccountClass: null,
        settledAt: nowIso,
      };
    }

    return this.ledgerService.creditPendingReward({
      attemptId: params.attemptId,
      publisherId: params.publisherId,
      respondentId: params.respondentId,
      amount: params.rewardPerResponse,
    });
  }

  /**
   * The posted settlement of an Internal response, or null (Epic 6 review
   * P5: replays and re-drives never re-price an existing reward).
   */
  findInternalSettlement(
    responseId: string,
  ): Promise<RewardSettlementResultDto | null> {
    return this.ledgerService.findInternalRewardSettlement(responseId);
  }

  /** The posted Pending credit of an External attempt, or null. */
  findExternalSettlement(
    attemptId: string,
  ): Promise<RewardSettlementResultDto | null> {
    return this.ledgerService.findPendingRewardSettlement(attemptId);
  }

  /**
   * The current state of the External completion credit of `attemptId`
   * (Epic 9 review P1/P3). A reversal wins over a release, so a credit that
   * was released and then reversed is `REVERSED`.
   */
  getExternalCreditState(attemptId: string): Promise<ExternalCreditState> {
    return this.ledgerService.getExternalCreditState(attemptId);
  }

  /**
   * Releases one matured pending external reward to USER_AVAILABLE (FR-24) and,
   * after the journal commits, notifies the respondent (FR-57). The
   * notification shares the journal identity, so a replay never duplicates it.
   *
   * Epic 6 review P2: owner, amount and 48-hour maturity come from the credit
   * journal (`LedgerService`), and the dispute check is server-side. An
   * already-posted release replays without the dispute check.
   */
  async releasePendingReward(
    params: ReleasePendingRewardParams,
  ): Promise<LedgerJournalEntity> {
    const alreadyReleased =
      await this.ledgerService.findJournalByIdempotencyKey(
        releasePendingKey(params.attemptId),
      );
    if (
      !alreadyReleased &&
      (await this.disputeHolds.hasOpenDisputeHold(params.attemptId))
    ) {
      throw new DisputeHoldActiveException(params.attemptId);
    }

    const journal = await this.ledgerService.releasePendingReward(params);
    const ownerId = await this.notifyRewardReleased(journal);
    // Story 7.2: a matured External completion can complete the Marketplace
    // activation step; the check is non-fatal and idempotent.
    if (ownerId) {
      await this.starterPoints?.tryUnlockStarterPoints(
        ownerId,
        'PENDING_RELEASE',
      );
    }
    return journal;
  }

  /**
   * Recipient and amount come from the committed journal, never from the
   * request. Returns the credited respondent (null when unknown).
   */
  private async notifyRewardReleased(
    journal: LedgerJournalEntity,
  ): Promise<string | null> {
    const credit = journal.entries.find((entry) => entry.amount > 0);
    if (!credit) {
      return null;
    }

    let ownerId: string | null;
    try {
      ownerId = (await this.ledgerService.getAccount(credit.accountId)).userId;
    } catch {
      return null;
    }
    if (!ownerId) {
      return null;
    }

    await this.notificationPublisher?.publish({
      userId: ownerId,
      type: 'REWARD_RELEASED',
      message: `${credit.amount} pending points from your external survey passed the 48-hour review window and are now in your Available balance.`,
      dedupeKey: journal.idempotencyKey,
    });
    return ownerId;
  }

  /**
   * AC6.4 scan (FR-24 "background job"): releases External completion
   * credits created at or before `cutoffDate` — clamped to now − 48 h, so a
   * caller can never release early — that were neither released nor
   * reversed, oldest first, `limit` per call. One failure never stops the
   * batch. The recurring scheduler is deferred (no worker infrastructure).
   */
  async releaseMaturedPendingRewards(
    params: ReleaseMaturedPendingRewardsParams = {},
  ): Promise<MaturedReleaseSummary> {
    const latestCutoff = new Date(
      this.ledgerService.now().getTime() - PENDING_REWARD_MATURITY_MS,
    );
    const cutoff =
      params.cutoffDate && params.cutoffDate.getTime() < latestCutoff.getTime()
        ? params.cutoffDate
        : latestCutoff;
    const limit = Math.min(
      MATURED_RELEASE_MAX_LIMIT,
      Math.max(1, Math.floor(params.limit ?? MATURED_RELEASE_DEFAULT_LIMIT)),
    );

    const credits = await this.ledgerService.findMaturedPendingCredits({
      cutoff,
      limit: limit + 1,
    });
    const batch = credits.slice(0, limit);

    let releasedCount = 0;
    let disputedCount = 0;
    let failedCount = 0;

    for (const credit of batch) {
      const attemptId = attemptIdFromExternalCompletionKey(
        credit.idempotencyKey,
      );
      if (!attemptId) {
        failedCount++;
        continue;
      }
      try {
        await this.releasePendingReward({ attemptId });
        releasedCount++;
      } catch (err) {
        if (err instanceof DisputeHoldActiveException) {
          disputedCount++;
        } else {
          failedCount++;
        }
      }
    }

    return {
      processed: batch.length,
      releasedCount,
      disputedCount,
      failedCount,
      hasMore: credits.length > limit,
      cutoffDate: cutoff.toISOString(),
    };
  }
}
