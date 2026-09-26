import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { LedgerService } from './ledger.service';
import { RewardSettlementCoordinator } from './reward-settlement.coordinator';
import { InMemoryNotificationRepository } from '../../notifications/infrastructure/in-memory-notification.repository';
import { NotificationsService } from '../../notifications/application/notifications.service';
import {
  DisputeHoldActiveException,
  PendingRewardNotMaturedException,
} from './exceptions/economy.exceptions';
import { ExternalDisputeHoldQueryPort } from './ports/external-dispute-hold-query.port';

const HOUR_MS = 60 * 60 * 1000;

describe('Story 6.4: RewardSettlementCoordinator', () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let coordinator: RewardSettlementCoordinator;
  /** Epic 6 review P2: the ledger clock drives the 48-hour window. */
  const creditTime = new Date('2026-09-20T08:00:00.000Z');
  let now: Date;

  const publisherId = '11111111-1111-4111-8111-111111111111';
  const respondentId = '22222222-2222-4222-8222-222222222222';
  const responseId = '33333333-3333-4333-8333-333333333333';
  const attemptId = '44444444-4444-4444-8444-444444444444';

  /** Dispute holds reported by the (Story 8.5) query port. */
  function disputeHolds(...attemptIds: string[]): ExternalDisputeHoldQueryPort {
    return {
      hasOpenDisputeHold: jest.fn(async (id: string) =>
        attemptIds.includes(id),
      ),
    };
  }

  function matured(): void {
    now = new Date(creditTime.getTime() + 48 * HOUR_MS);
  }

  beforeEach(async () => {
    now = creditTime;
    ledgerRepo = new InMemoryLedgerRepository();
    ledgerService = new LedgerService(ledgerRepo, { clock: () => now });
    coordinator = new RewardSettlementCoordinator(ledgerService);

    // Seed publisher escrow account with 200 points
    const system = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const escrow = await ledgerService.getOrCreateAccount(
      publisherId,
      'ESCROW',
    );
    await ledgerService.postJournal({
      idempotencyKey: 'seed-escrow',
      entries: [
        { accountId: system.id, amount: -200 },
        { accountId: escrow.id, amount: 200 },
      ],
    });
  });

  describe('settleInternalReward', () => {
    it('instant settlements authenticated submission in SHADOW mode (FR-29)', async () => {
      const result = await coordinator.settleInternalReward({
        responseId,
        publisherId,
        respondentId,
        rewardPerResponse: 25,
        policyMode: 'SHADOW',
      });

      expect(result.status).toBe('SETTLED');
      expect(result.amount).toBe(25);
      expect(result.targetAccountClass).toBe('USER_AVAILABLE');

      const wallet = await ledgerService.getWallet(respondentId);
      expect(wallet.balance.available).toBe(25);
    });

    it('holds points in INTEGRITY_HOLD in ENFORCED mode', async () => {
      const result = await coordinator.settleInternalReward({
        responseId,
        publisherId,
        respondentId,
        rewardPerResponse: 30,
        policyMode: 'ENFORCED',
      });

      expect(result.status).toBe('HELD_IN_INTEGRITY');
      expect(result.amount).toBe(30);
      expect(result.targetAccountClass).toBe('INTEGRITY_HOLD');

      const wallet = await ledgerService.getWallet(respondentId);
      expect(wallet.balance.available).toBe(0);
      expect(wallet.balance.integrityHold).toBe(30);
    });

    it('returns SKIPPED_GUEST for guest submissions', async () => {
      const result = await coordinator.settleInternalReward({
        responseId,
        publisherId,
        respondentId: null,
        rewardPerResponse: 25,
      });

      expect(result.status).toBe('SKIPPED_GUEST');
      expect(result.amount).toBe(0);
      expect(result.journalId).toBeNull();
    });

    it('handles zero-reward free survey gracefully without ledger movement', async () => {
      const result = await coordinator.settleInternalReward({
        responseId,
        publisherId,
        respondentId,
        rewardPerResponse: 0,
      });

      expect(result.status).toBe('SETTLED');
      expect(result.amount).toBe(0);
      expect(result.journalId).toBeNull();
    });
  });

  describe('decision E9-D2: REWARD_EARNED after an Internal instant credit (FR-57 "Points earned")', () => {
    let notificationRepo: InMemoryNotificationRepository;
    let notifying: RewardSettlementCoordinator;

    const shadowParams = {
      responseId,
      publisherId,
      respondentId,
      rewardPerResponse: 25,
      policyMode: 'SHADOW' as const,
    };

    beforeEach(() => {
      notificationRepo = new InMemoryNotificationRepository();
      notifying = new RewardSettlementCoordinator(
        ledgerService,
        new NotificationsService(notificationRepo),
      );
    });

    it('notifies the respondent once, after the journal commits, with the full credited amount', async () => {
      const journalsAtPublish: Array<string | null> = [];
      const publisher = {
        publish: jest.fn(async () => {
          const journal = await ledgerService.findJournalByIdempotencyKey(
            `internal-reward:${responseId}`,
          );
          journalsAtPublish.push(journal?.id ?? null);
          return 'CREATED' as const;
        }),
      };
      const spying = new RewardSettlementCoordinator(ledgerService, publisher);

      const result = await spying.settleInternalReward(shadowParams);

      // Decision E6-D1: Escrow pays round(0.8 x 25) = 20, the platform 5; the
      // respondent is credited (and told about) the advertised 25.
      expect(result).toMatchObject({ status: 'SETTLED', amount: 25 });
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.publish).toHaveBeenCalledWith({
        userId: respondentId,
        type: 'REWARD_EARNED',
        message: expect.stringMatching(/^25 points/),
        dedupeKey: `internal-reward:${responseId}`,
      });
      expect(journalsAtPublish).toEqual([result.journalId]);
    });

    it('stores one notification and a replay of the same settlement adds none', async () => {
      const first = await notifying.settleInternalReward(shadowParams);
      const replay = await notifying.settleInternalReward(shadowParams);

      expect(replay.journalId).toBe(first.journalId);
      expect(notificationRepo.all()).toEqual([
        expect.objectContaining({
          userId: respondentId,
          type: 'REWARD_EARNED',
          dedupeKey: `internal-reward:${responseId}`,
          isRead: false,
        }),
      ]);
      expect(notificationRepo.all()[0].message).toContain('25 points');
      expect(
        (await ledgerService.getWallet(respondentId)).balance.available,
      ).toBe(25);
    });

    it('does not notify an Integrity Hold, a guest or a zero-reward survey', async () => {
      await notifying.settleInternalReward({
        ...shadowParams,
        policyMode: 'ENFORCED',
      });
      await notifying.settleInternalReward({
        ...shadowParams,
        responseId: '55555555-5555-4555-8555-555555555555',
        respondentId: null,
      });
      await notifying.settleInternalReward({
        ...shadowParams,
        responseId: '66666666-6666-4666-8666-666666666666',
        rewardPerResponse: 0,
      });

      expect(notificationRepo.all()).toHaveLength(0);
    });

    it('does not notify a credit that could not be posted', async () => {
      await expect(
        notifying.settleInternalReward({
          ...shadowParams,
          rewardPerResponse: 500, // Escrow 200 < round(0.8 x 500)
        }),
      ).rejects.toThrow();

      expect(notificationRepo.all()).toHaveLength(0);
    });

    it('keeps the settlement result when the notice cannot be recorded or the publisher breaks its contract', async () => {
      jest
        .spyOn(notificationRepo, 'createIfAbsent')
        .mockRejectedValueOnce(new Error('notifications table unavailable'));
      const failedNotice = await notifying.settleInternalReward(shadowParams);
      expect(failedNotice).toMatchObject({ status: 'SETTLED', amount: 25 });
      expect(notificationRepo.all()).toHaveLength(0);

      const throwing = new RewardSettlementCoordinator(ledgerService, {
        publish: jest.fn().mockRejectedValue(new Error('publisher down')),
      });
      const otherResponse = '77777777-7777-4777-8777-777777777777';
      await expect(
        throwing.settleInternalReward({
          ...shadowParams,
          responseId: otherResponse,
        }),
      ).resolves.toMatchObject({ status: 'SETTLED', amount: 25 });
    });
  });

  describe('settleExternalReward', () => {
    it('credits points to PENDING for external completion (FR-24)', async () => {
      const result = await coordinator.settleExternalReward({
        attemptId,
        publisherId,
        respondentId,
        rewardPerResponse: 20,
      });

      expect(result.status).toBe('PENDING');
      expect(result.amount).toBe(20);
      expect(result.targetAccountClass).toBe('PENDING');

      const wallet = await ledgerService.getWallet(respondentId);
      expect(wallet.balance.pending).toBe(20);
      expect(wallet.balance.available).toBe(0);
    });
  });

  describe('releaseMaturedPendingRewards (AC6.4, Epic 6 review P2)', () => {
    it('scans and releases matured external rewards when no disputes exist', async () => {
      await coordinator.settleExternalReward({
        attemptId,
        publisherId,
        respondentId,
        rewardPerResponse: 20,
      });
      matured();

      const summary = await coordinator.releaseMaturedPendingRewards();

      expect(summary).toMatchObject({
        processed: 1,
        releasedCount: 1,
        disputedCount: 0,
        failedCount: 0,
        hasMore: false,
      });

      const wallet = await ledgerService.getWallet(respondentId);
      expect(wallet.balance.pending).toBe(0);
      expect(wallet.balance.available).toBe(20);
    });

    it('never releases before 48 hours, even with a later cutoff', async () => {
      await coordinator.settleExternalReward({
        attemptId,
        publisherId,
        respondentId,
        rewardPerResponse: 20,
      });
      now = new Date(creditTime.getTime() + 47 * HOUR_MS);

      const summary = await coordinator.releaseMaturedPendingRewards({
        cutoffDate: new Date(creditTime.getTime() + 100 * HOUR_MS),
      });

      expect(summary.processed).toBe(0);
      expect(new Date(summary.cutoffDate).getTime()).toBe(
        now.getTime() - 48 * HOUR_MS,
      );
      const wallet = await ledgerService.getWallet(respondentId);
      expect(wallet.balance.pending).toBe(20);
    });

    it('releases in bounded batches, oldest first, and reports hasMore', async () => {
      const attempts = [
        '44444444-4444-4444-8444-444444444441',
        '44444444-4444-4444-8444-444444444442',
        '44444444-4444-4444-8444-444444444443',
      ];
      for (const [index, id] of attempts.entries()) {
        now = new Date(creditTime.getTime() + index * HOUR_MS);
        await coordinator.settleExternalReward({
          attemptId: id,
          publisherId,
          respondentId,
          rewardPerResponse: 10,
        });
      }
      now = new Date(creditTime.getTime() + 60 * HOUR_MS);

      const first = await coordinator.releaseMaturedPendingRewards({
        limit: 2,
      });
      expect(first).toMatchObject({ processed: 2, hasMore: true });
      expect(
        await ledgerService.findJournalByIdempotencyKey(
          `release-pending:${attempts[2]}`,
        ),
      ).toBeNull();

      // Already-released credits are not rescanned.
      const second = await coordinator.releaseMaturedPendingRewards({
        limit: 2,
      });
      expect(second).toMatchObject({
        processed: 1,
        releasedCount: 1,
        hasMore: false,
      });
      const wallet = await ledgerService.getWallet(respondentId);
      expect(wallet.balance.available).toBe(30);
    });

    it('skips attempts under a server-side dispute hold and reports them', async () => {
      const disputed = new RewardSettlementCoordinator(
        ledgerService,
        undefined,
        undefined,
        disputeHolds(attemptId),
      );
      await disputed.settleExternalReward({
        attemptId,
        publisherId,
        respondentId,
        rewardPerResponse: 20,
      });
      matured();

      const summary = await disputed.releaseMaturedPendingRewards();

      expect(summary).toMatchObject({
        processed: 1,
        releasedCount: 0,
        disputedCount: 1,
      });

      const wallet = await ledgerService.getWallet(respondentId);
      expect(wallet.balance.pending).toBe(20);
      expect(wallet.balance.available).toBe(0);
    });
  });

  describe('releasePendingReward (Epic 6 review P2)', () => {
    beforeEach(async () => {
      await coordinator.settleExternalReward({
        attemptId,
        publisherId,
        respondentId,
        rewardPerResponse: 20,
      });
    });

    it('refuses an immature release', async () => {
      await expect(
        coordinator.releasePendingReward({ attemptId, respondentId }),
      ).rejects.toBeInstanceOf(PendingRewardNotMaturedException);
    });

    it('checks the dispute hold server-side, not from the caller', async () => {
      const holds = disputeHolds(attemptId);
      const disputed = new RewardSettlementCoordinator(
        ledgerService,
        undefined,
        undefined,
        holds,
      );
      matured();

      await expect(
        disputed.releasePendingReward({ attemptId }),
      ).rejects.toBeInstanceOf(DisputeHoldActiveException);
      expect(holds.hasOpenDisputeHold).toHaveBeenCalledWith(attemptId);
    });

    it('replays an existing release without re-checking disputes', async () => {
      matured();
      const first = await coordinator.releasePendingReward({ attemptId });
      const holds = disputeHolds(attemptId);
      const disputed = new RewardSettlementCoordinator(
        ledgerService,
        undefined,
        undefined,
        holds,
      );

      const replay = await disputed.releasePendingReward({ attemptId });

      expect(replay.id).toBe(first.id);
      expect(holds.hasOpenDisputeHold).not.toHaveBeenCalled();
    });

    it('exposes posted settlements for replays and re-drives (Epic 6 review P5)', async () => {
      expect(await coordinator.findExternalSettlement(attemptId)).toEqual(
        expect.objectContaining({ status: 'PENDING', amount: 20 }),
      );
      expect(await coordinator.findInternalSettlement(responseId)).toBeNull();
    });
  });
  describe('getExternalCreditState (Epic 9 review P1)', () => {
    const otherAttemptId = '55555555-5555-4555-8555-555555555555';

    async function credit(id: string): Promise<string> {
      const result = await coordinator.settleExternalReward({
        attemptId: id,
        publisherId,
        respondentId,
        rewardPerResponse: 20,
      });
      return result.journalId as string;
    }

    it('is NONE when no completion credit exists', async () => {
      expect(await coordinator.getExternalCreditState(attemptId)).toBe('NONE');
    });

    it('is PENDING after the credit and RELEASED after the 48-hour release', async () => {
      await credit(attemptId);
      expect(await coordinator.getExternalCreditState(attemptId)).toBe(
        'PENDING',
      );

      matured();
      await coordinator.releasePendingReward({ attemptId });
      expect(await coordinator.getExternalCreditState(attemptId)).toBe(
        'RELEASED',
      );
    });

    it('is REVERSED after an admin reversal of the pending credit', async () => {
      const creditJournalId = await credit(attemptId);
      await ledgerService.reverseJournal({ targetJournalId: creditJournalId });

      expect(await coordinator.getExternalCreditState(attemptId)).toBe(
        'REVERSED',
      );
    });

    it('reports REVERSED when the credit was reversed after its release', async () => {
      const creditJournalId = await credit(attemptId);
      matured();
      await coordinator.releasePendingReward({ attemptId });
      // A second Pending credit keeps the Pending account funded, so the
      // reversal of the released credit does not overdraw it.
      await credit(otherAttemptId);
      await ledgerService.reverseJournal({ targetJournalId: creditJournalId });

      expect(await coordinator.getExternalCreditState(attemptId)).toBe(
        'REVERSED',
      );
      expect(await coordinator.getExternalCreditState(otherAttemptId)).toBe(
        'PENDING',
      );
    });
  });

  describe('Story 9.6: pending release notifications', () => {
    let notificationRepo: InMemoryNotificationRepository;
    let notifyingCoordinator: RewardSettlementCoordinator;

    beforeEach(async () => {
      notificationRepo = new InMemoryNotificationRepository();
      notifyingCoordinator = new RewardSettlementCoordinator(
        ledgerService,
        new NotificationsService(notificationRepo),
      );
      await notifyingCoordinator.settleExternalReward({
        attemptId,
        publisherId,
        respondentId,
        rewardPerResponse: 20,
      });
      matured();
    });

    it('notifies the respondent once when a pending reward is released', async () => {
      const journal = await notifyingCoordinator.releasePendingReward({
        attemptId,
        respondentId,
      });

      expect(journal.idempotencyKey).toBe(`release-pending:${attemptId}`);
      const [notification] = notificationRepo.all();
      expect(notificationRepo.all()).toHaveLength(1);
      expect(notification).toMatchObject({
        userId: respondentId,
        type: 'REWARD_RELEASED',
        dedupeKey: `release-pending:${attemptId}`,
        isRead: false,
      });
      expect(notification.message).toMatch(/20/);

      // Replay returns the original journal and creates no second notification.
      const replay = await notifyingCoordinator.releasePendingReward({
        attemptId,
        respondentId,
      });
      expect(replay.id).toBe(journal.id);
      expect(notificationRepo.all()).toHaveLength(1);
    });

    it('does not notify while a dispute hold blocks the release', async () => {
      const blocked = new RewardSettlementCoordinator(
        ledgerService,
        new NotificationsService(notificationRepo),
        undefined,
        disputeHolds(attemptId),
      );

      await expect(
        blocked.releasePendingReward({ attemptId, respondentId }),
      ).rejects.toBeInstanceOf(DisputeHoldActiveException);
      expect(notificationRepo.all()).toHaveLength(0);
    });

    it('does not notify an immature release', async () => {
      now = creditTime;
      await expect(
        notifyingCoordinator.releasePendingReward({ attemptId }),
      ).rejects.toBeInstanceOf(PendingRewardNotMaturedException);
      expect(notificationRepo.all()).toHaveLength(0);
    });

    it('notifies per released credit in the matured-release sweep', async () => {
      const disputedAttempt = '55555555-5555-4555-8555-555555555555';
      const sweeping = new RewardSettlementCoordinator(
        ledgerService,
        new NotificationsService(notificationRepo),
        undefined,
        disputeHolds(disputedAttempt),
      );
      now = creditTime;
      await sweeping.settleExternalReward({
        attemptId: disputedAttempt,
        publisherId,
        respondentId,
        rewardPerResponse: 10,
      });
      matured();

      const summary = await sweeping.releaseMaturedPendingRewards();

      expect(summary).toMatchObject({ releasedCount: 1, disputedCount: 1 });
      expect(notificationRepo.all().map((n) => n.dedupeKey)).toEqual([
        `release-pending:${attemptId}`,
      ]);
    });

    it('takes recipient and amount from the credit, never from the caller', async () => {
      const victimId = '66666666-6666-4666-8666-666666666666';
      await notifyingCoordinator.releasePendingReward({ attemptId });

      // A replay claiming another respondent or a forged amount is refused.
      await expect(
        notifyingCoordinator.releasePendingReward({
          attemptId,
          respondentId: victimId,
        }),
      ).rejects.toThrow(/own pending rewards/);
      await expect(
        notifyingCoordinator.releasePendingReward({ attemptId, amount: 999 }),
      ).rejects.toThrow(/does not match/);

      expect(notificationRepo.all()).toHaveLength(1);
      expect(notificationRepo.all()[0].userId).toBe(respondentId);
      expect(notificationRepo.all()[0].message).toMatch(/^20 /);
      expect(notificationRepo.all().some((n) => n.userId === victimId)).toBe(
        false,
      );
    });

    it('keeps the release result when the notification cannot be recorded', async () => {
      jest
        .spyOn(notificationRepo, 'createIfAbsent')
        .mockRejectedValueOnce(new Error('notifications table unavailable'));

      const journal = await notifyingCoordinator.releasePendingReward({
        attemptId,
        respondentId,
      });

      expect(journal.idempotencyKey).toBe(`release-pending:${attemptId}`);
      const wallet = await ledgerService.getWallet(respondentId);
      expect(wallet.balance.available).toBe(20);
    });
  });
  describe('Story 7.2: starter points activation after a Pending release', () => {
    it('re-checks the activation step for the credited respondent (derived from the journal) after the release commits', async () => {
      const starterPoints = {
        tryUnlockStarterPoints: jest.fn().mockResolvedValue({ unlocked: true }),
      };
      const activating = new RewardSettlementCoordinator(
        ledgerService,
        undefined,
        starterPoints,
      );
      await activating.settleExternalReward({
        attemptId,
        publisherId,
        respondentId,
        rewardPerResponse: 30,
      });
      matured();

      // An Admin/worker release names no respondent: the unlock check still
      // targets the credited respondent (Epic 6 review P2 x Story 7.2).
      await activating.releasePendingReward({ attemptId });

      expect(starterPoints.tryUnlockStarterPoints).toHaveBeenCalledWith(
        respondentId,
        'PENDING_RELEASE',
      );
    });

    it('does not re-check when the release is blocked by a dispute hold', async () => {
      const starterPoints = { tryUnlockStarterPoints: jest.fn() };
      const activating = new RewardSettlementCoordinator(
        ledgerService,
        undefined,
        starterPoints,
        disputeHolds(attemptId),
      );
      await activating.settleExternalReward({
        attemptId,
        publisherId,
        respondentId,
        rewardPerResponse: 30,
      });
      matured();

      await expect(
        activating.releasePendingReward({ attemptId, respondentId }),
      ).rejects.toThrow(DisputeHoldActiveException);
      expect(starterPoints.tryUnlockStarterPoints).not.toHaveBeenCalled();
    });
  });
});
