import {
  NOTIFICATION_RECOVERY_WINDOW_MS,
  StarterPointsCoordinator,
} from './starter-points.coordinator';
import { LedgerService } from './ledger.service';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { InMemoryStarterPointsDataProvider } from '../infrastructure/in-memory-starter-points-data-provider';
import { InMemoryNotificationRepository } from '../../notifications/infrastructure/in-memory-notification.repository';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { InvalidLedgerOperationException } from './exceptions/economy.exceptions';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('StarterPointsCoordinator', () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let dataProvider: InMemoryStarterPointsDataProvider;
  let notificationRepo: InMemoryNotificationRepository;
  let logger: { warn: jest.Mock };
  let coordinator: StarterPointsCoordinator;

  const userId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    ledgerRepo = new InMemoryLedgerRepository();
    ledgerService = new LedgerService(ledgerRepo);
    dataProvider = new InMemoryStarterPointsDataProvider();
    notificationRepo = new InMemoryNotificationRepository();
    logger = { warn: jest.fn() };
    coordinator = new StarterPointsCoordinator(
      ledgerService,
      dataProvider,
      new NotificationsService(notificationRepo),
      logger,
    );

    dataProvider.userRegistrationDates.set(userId, new Date());
  });

  const externalPublisherId = 'fe000000-0000-4000-8000-000000000001';

  /**
   * Review 3.5: an External completion counts only with a Pending or Released
   * ledger credit, so tests that record one also post its credit.
   */
  async function creditExternal(
    respondentId: string,
    attemptId: string,
    amount = 10,
  ): Promise<string> {
    const escrow = await ledgerService.getOrCreateAccount(
      externalPublisherId,
      'ESCROW',
    );
    const issuance = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    await ledgerService.postJournal({
      idempotencyKey: `seed-escrow:${attemptId}`,
      entries: [
        { accountId: issuance.id, amount: -amount },
        { accountId: escrow.id, amount },
      ],
    });
    const credit = await ledgerService.creditPendingReward({
      attemptId,
      publisherId: externalPublisherId,
      respondentId,
      amount,
    });
    return credit.journalId!;
  }

  function activationNotifications(forUser = userId) {
    return notificationRepo
      .all()
      .filter((n) => n.userId === forUser && n.type === 'ACCOUNT_ACTIVATED');
  }

  describe('grantStarterPoints', () => {
    it('grants 100 starter points to user FROZEN account', async () => {
      const result = await coordinator.grantStarterPoints(userId);

      expect(result.granted).toBe(true);
      expect(result.journalId).toEqual(expect.any(String));

      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(100);
      expect(wallet.balance.available).toBe(0);
    });

    it('is idempotent on duplicate grant calls', async () => {
      const first = await coordinator.grantStarterPoints(userId);
      const second = await coordinator.grantStarterPoints(userId);

      expect(first.journalId).toBe(second.journalId);
      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(100);
    });
  });

  describe('ensureStarterGrant (self-healing FR-4 grant)', () => {
    async function grantJournalCount(forUser = userId) {
      return (await ledgerService.getWallet(forUser)).transactions.filter(
        (t) => t.idempotencyKey === `starter-grant:${forUser}`,
      ).length;
    }

    it('grants 100 Frozen exactly once to a user inside the 30-day window', async () => {
      await expect(coordinator.ensureStarterGrant(userId)).resolves.toBe(true);
      await expect(coordinator.ensureStarterGrant(userId)).resolves.toBe(false);
      await Promise.all([
        coordinator.ensureStarterGrant(userId),
        coordinator.ensureStarterGrant(userId),
      ]);

      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(100);
      expect(await grantJournalCount()).toBe(1);
    });

    it('does not grant once the 30-day window has passed', async () => {
      dataProvider.userRegistrationDates.set(
        userId,
        new Date(Date.now() - 31 * DAY),
      );

      await expect(coordinator.ensureStarterGrant(userId)).resolves.toBe(false);
      expect((await ledgerService.getWallet(userId)).balance.frozen).toBe(0);
    });

    it('does not grant when the registration date cannot be found', async () => {
      jest
        .spyOn(dataProvider, 'getUserRegistrationDate')
        .mockResolvedValue(null);

      await expect(coordinator.ensureStarterGrant(userId)).resolves.toBe(false);
      expect((await ledgerService.getWallet(userId)).balance.frozen).toBe(0);
    });

    it('does not grant again after the starter points expired', async () => {
      const issuance = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const sink = await ledgerService.getOrCreateAccount(null, 'SYSTEM_SINK');
      await ledgerService.postJournal({
        idempotencyKey: `starter-expiry:${userId}`,
        entries: [
          { accountId: issuance.id, amount: -1 },
          { accountId: sink.id, amount: 1 },
        ],
      });

      await expect(coordinator.ensureStarterGrant(userId)).resolves.toBe(false);
      expect(await grantJournalCount()).toBe(0);
    });

    it('never throws: logs the failure without balances and heals on the next status read', async () => {
      jest
        .spyOn(ledgerService, 'grantStarterPoints')
        .mockRejectedValueOnce(new Error('database unavailable'));

      await expect(coordinator.ensureStarterGrant(userId)).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`grant failed for user ${userId}.*database unavailable`),
        ),
      );
      expect(logger.warn.mock.calls[0][0]).not.toMatch(/balance|frozen/i);
      expect((await ledgerService.getWallet(userId)).balance.frozen).toBe(0);

      const status = await coordinator.getStatus(userId);

      expect(status.isGranted).toBe(true);
      expect(status.frozenBalance).toBe(100);
      expect(status.activationState).toBe('DEMOGRAPHICS_REQUIRED');
      await coordinator.getStatus(userId);
      expect(await grantJournalCount()).toBe(1);
    });

    it('never throws when the ledger lookup itself fails', async () => {
      jest
        .spyOn(ledgerService, 'findJournalByIdempotencyKey')
        .mockRejectedValueOnce(new Error('connection reset'));

      await expect(coordinator.ensureStarterGrant(userId)).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('lets an unlock trigger recover a missing grant and then unlock it', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);

      const result = await coordinator.tryUnlockStarterPoints(
        userId,
        'INTERNAL_SUBMISSION',
      );

      expect(result).toMatchObject({ unlocked: true, amount: 100 });
      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(100);
      expect(await grantJournalCount()).toBe(1);
    });
  });

  describe('getStatus', () => {
    it('reports pending onboarding when demographic profile and surveys are incomplete', async () => {
      await coordinator.grantStarterPoints(userId);

      const status = await coordinator.getStatus(userId);

      expect(status.userId).toBe(userId);
      expect(status.isGranted).toBe(true);
      expect(status.frozenBalance).toBe(100);
      expect(status.isDemographicComplete).toBe(false);
      expect(status.hasCompletedMarketplaceSurvey).toBe(false);
      expect(status.isUnlocked).toBe(false);
      expect(status.isExpired).toBe(false);
      expect(status.daysRemaining).toBe(30);
      expect(status.activationState).toBe('DEMOGRAPHICS_REQUIRED');
      expect(status.activatedAt).toBeNull();
      expect(status.activationSurvey).toBeNull();
      expect(status.unlockEligibility.eligible).toBe(false);
      expect(status.unlockEligibility.missingSteps).toContain(
        'Complete Mandatory Demographic Survey',
      );
      expect(status.unlockEligibility.missingSteps).toContain(
        'Complete 1 Marketplace Survey',
      );
    });

    it('prompts for one Marketplace survey after the demographic survey (FR-7)', async () => {
      await coordinator.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);

      const status = await coordinator.getStatus(userId);

      expect(status.activationState).toBe('SURVEY_REQUIRED');
      expect(status.unlockEligibility.missingSteps).toEqual([
        'Complete 1 Marketplace Survey',
      ]);
    });

    it('reports eligible when demographic profile is complete and 1 marketplace survey is completed', async () => {
      await coordinator.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId, { formId: 'form-a' });

      const status = await coordinator.getStatus(userId);

      expect(status.isDemographicComplete).toBe(true);
      expect(status.hasCompletedMarketplaceSurvey).toBe(true);
      expect(status.activationState).toBe('READY_TO_UNLOCK');
      expect(status.activationSurvey).toMatchObject({
        source: 'INTERNAL',
        formId: 'form-a',
        status: 'CONFIRMED',
      });
      expect(status.unlockEligibility.eligible).toBe(true);
      expect(status.unlockEligibility.missingSteps).toHaveLength(0);
    });

    it('does not count a zero-reward survey toward activation (decision E7-DN2, B(1))', async () => {
      await coordinator.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId, {
        formId: 'free-internal',
        rewardPerResponse: 0,
      });
      dataProvider.recordCompletion(userId, {
        source: 'EXTERNAL',
        formId: 'free-external',
        attemptId: '12121212-1212-4212-8212-121212121212',
        completedAt: new Date(Date.now() - 3 * DAY),
        rewardPerResponse: 0,
      });

      const status = await coordinator.getStatus(userId);
      expect(status.activationState).toBe('SURVEY_REQUIRED');
      expect(status.hasCompletedMarketplaceSurvey).toBe(false);
      expect(status.activationSurvey).toBeNull();
      expect(status.isVerifiedMember).toBe(false);

      const result = await coordinator.checkAndUnlockStarterPoints(userId);
      expect(result.unlocked).toBe(false);
      expect((await ledgerService.getWallet(userId)).balance.frozen).toBe(100);

      // A 1-point survey qualifies.
      dataProvider.recordCompletion(userId, {
        formId: 'one-point',
        rewardPerResponse: 1,
      });
      expect(
        (await coordinator.checkAndUnlockStarterPoints(userId)).unlocked,
      ).toBe(true);
    });

    it('reports isVerifiedMember once both steps are done (decision E7-DN3)', async () => {
      await coordinator.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);
      expect((await coordinator.getStatus(userId)).isVerifiedMember).toBe(
        false,
      );

      dataProvider.recordCompletion(userId, { formId: 'form-a' });
      const ready = await coordinator.getStatus(userId);
      expect(ready.activationState).toBe('READY_TO_UNLOCK');
      expect(ready.isVerifiedMember).toBe(true);

      await coordinator.checkAndUnlockStarterPoints(userId);
      const activated = await coordinator.getStatus(userId);
      expect(activated.activationState).toBe('ACTIVATED');
      expect(activated.isVerifiedMember).toBe(true);
    });

    it('makes an expired respondent a Verified Member after a late completion, without unlocking the points (decision E7-DN3)', async () => {
      dataProvider.userRegistrationDates.set(
        userId,
        new Date(Date.now() - 35 * DAY),
      );
      dataProvider.demographicCompletions.set(userId, true);
      await coordinator.grantStarterPoints(userId);
      await coordinator.expireUnmaturedStarterPoints();

      const expired = await coordinator.getStatus(userId);
      expect(expired.activationState).toBe('EXPIRED');
      expect(expired.isVerifiedMember).toBe(false);

      // Completed today, long after the 30-day window.
      dataProvider.recordCompletion(userId, { formId: 'late-form' });

      const status = await coordinator.getStatus(userId);
      expect(status.activationState).toBe('EXPIRED');
      expect(status.isExpired).toBe(true);
      expect(status.hasCompletedMarketplaceSurvey).toBe(false);
      expect(status.isVerifiedMember).toBe(true);
      const result = await coordinator.checkAndUnlockStarterPoints(userId);
      expect(result.unlocked).toBe(false);
      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(0);
    });

    it('checks at most one confirmed completion past the deadline for the Verified Member flag (bounded reversal lookups)', async () => {
      dataProvider.userRegistrationDates.set(
        userId,
        new Date(Date.now() - 40 * DAY),
      );
      dataProvider.demographicCompletions.set(userId, true);
      await coordinator.grantStarterPoints(userId);
      for (let i = 0; i < 6; i++) {
        dataProvider.recordCompletion(userId, {
          source: 'EXTERNAL',
          formId: `late-ext-${i}`,
          attemptId: `a0000000-0000-4000-8000-00000000000${i}`,
          // Deadline was 10 days ago; these are 2..7 days old (all late).
          completedAt: new Date(Date.now() - (2 + i) * DAY),
        });
        await creditExternal(userId, `a0000000-0000-4000-8000-00000000000${i}`);
      }
      // One still under review: skipped without a lookup.
      dataProvider.recordCompletion(userId, {
        source: 'EXTERNAL',
        formId: 'late-ext-pending',
        attemptId: 'a0000000-0000-4000-8000-000000000099',
        completedAt: new Date(Date.now() - HOUR),
      });
      const lookup = jest.spyOn(ledgerService, 'getExternalSettlementState');

      const status = await coordinator.getStatus(userId);

      expect(status.activationState).toBe('EXPIRED');
      expect(status.isVerifiedMember).toBe(true);
      expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('keeps an External completion pending for the 48-hour review window', async () => {
      await coordinator.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);
      const completedAt = new Date(Date.now() - 2 * HOUR);
      dataProvider.recordCompletion(userId, {
        source: 'EXTERNAL',
        formId: 'ext-a',
        attemptId: '33333333-3333-4333-8333-333333333333',
        completedAt,
      });
      await creditExternal(userId, '33333333-3333-4333-8333-333333333333');

      const status = await coordinator.getStatus(userId);

      expect(status.activationState).toBe('PENDING_CONFIRMATION');
      expect(status.hasCompletedMarketplaceSurvey).toBe(false);
      expect(status.unlockEligibility.eligible).toBe(false);
      expect(status.activationSurvey).toMatchObject({
        source: 'EXTERNAL',
        status: 'PENDING_REVIEW',
        confirmsAt: new Date(completedAt.getTime() + 48 * HOUR).toISOString(),
      });
    });

    it('ignores an External completion whose Pending credit was reversed (Phase-1 dispute)', async () => {
      const attemptId = '44444444-4444-4444-8444-444444444444';
      const publisherId = '55555555-5555-4555-8555-555555555555';
      await coordinator.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId, {
        source: 'EXTERNAL',
        formId: 'ext-disputed',
        attemptId,
        completedAt: new Date(Date.now() - 3 * DAY),
      });
      const escrow = await ledgerService.getOrCreateAccount(
        publisherId,
        'ESCROW',
      );
      const issuance = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      await ledgerService.postJournal({
        idempotencyKey: 'seed-escrow',
        entries: [
          { accountId: issuance.id, amount: -10 },
          { accountId: escrow.id, amount: 10 },
        ],
      });
      const credit = await ledgerService.creditPendingReward({
        attemptId,
        publisherId,
        respondentId: userId,
        amount: 10,
      });
      await ledgerService.reverseJournal({
        targetJournalId: credit.journalId!,
      });

      const status = await coordinator.getStatus(userId);

      expect(status.activationState).toBe('SURVEY_REQUIRED');
      expect(status.activationSurvey).toBeNull();
    });
  });

  describe('External settlement state (review 3.5)', () => {
    const attemptId = 'c0000000-0000-4000-8000-000000000001';
    const caseId = 'c0000000-0000-4000-8000-0000000000ca';

    beforeEach(async () => {
      await coordinator.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId, {
        source: 'EXTERNAL',
        formId: 'ext-settled',
        attemptId,
        completedAt: new Date(Date.now() - 3 * DAY),
      });
    });

    async function activationState(): Promise<string> {
      return (await coordinator.getStatus(userId)).activationState;
    }

    it('does not count a completion without a ledger credit', async () => {
      expect(await activationState()).toBe('SURVEY_REQUIRED');
      expect(
        (await coordinator.checkAndUnlockStarterPoints(userId)).unlocked,
      ).toBe(false);
    });

    it('counts a Pending credit', async () => {
      await creditExternal(userId, attemptId);

      expect(await activationState()).toBe('READY_TO_UNLOCK');
    });

    it('counts a Released credit', async () => {
      await creditExternal(userId, attemptId);
      const matured = new LedgerService(ledgerRepo, {
        clock: () => new Date(Date.now() + 49 * HOUR),
      });
      await matured.releasePendingReward({ attemptId });

      expect(await ledgerService.getExternalSettlementState(attemptId)).toBe(
        'RELEASED',
      );
      expect(await activationState()).toBe('READY_TO_UNLOCK');
    });

    it('does not count a credit under an open dispute hold', async () => {
      await creditExternal(userId, attemptId);
      await ledgerService.placeDisputeHold({
        caseId,
        attemptId,
        respondentId: userId,
        amount: 10,
      });

      expect(await activationState()).toBe('SURVEY_REQUIRED');
      expect(
        (await coordinator.checkAndUnlockStarterPoints(userId)).unlocked,
      ).toBe(false);
      expect((await ledgerService.getWallet(userId)).balance.frozen).toBe(100);
    });

    it('does not count a credit refunded to the Publisher', async () => {
      await creditExternal(userId, attemptId);
      await ledgerService.placeDisputeHold({
        caseId,
        attemptId,
        respondentId: userId,
        amount: 10,
      });
      await ledgerService.resolveDisputeHold({
        caseId,
        respondentId: userId,
        publisherId: externalPublisherId,
        amount: 10,
        outcome: 'REFUND_TO_PUBLISHER',
      });

      expect(await activationState()).toBe('SURVEY_REQUIRED');
    });

    it('does not let 20 disqualified External attempts hide a valid 21st', async () => {
      dataProvider.clear();
      dataProvider.userRegistrationDates.set(userId, new Date());
      dataProvider.demographicCompletions.set(userId, true);
      for (let i = 0; i < 20; i++) {
        const disqualified = `d0000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`;
        dataProvider.recordCompletion(userId, {
          source: 'EXTERNAL',
          formId: `ext-${i}`,
          attemptId: disqualified,
          completedAt: new Date(Date.now() - (5 * DAY - i * HOUR)),
        });
        // Alternate reversed credits and missing credits.
        if (i % 2 === 0) {
          await ledgerService.reverseJournal({
            targetJournalId: await creditExternal(userId, disqualified),
          });
        }
      }
      const valid = 'd0000000-0000-4000-8000-000000000099';
      dataProvider.recordCompletion(userId, {
        source: 'EXTERNAL',
        formId: 'ext-valid',
        attemptId: valid,
        completedAt: new Date(Date.now() - 3 * DAY),
      });
      await creditExternal(userId, valid);
      const lookup = jest.spyOn(
        dataProvider,
        'findActivationSurveyCompletions',
      );

      const status = await coordinator.getStatus(userId);

      expect(status.activationState).toBe('READY_TO_UNLOCK');
      expect(status.activationSurvey).toMatchObject({ formId: 'ext-valid' });
      expect(lookup.mock.calls.map(([, options]) => options.limit)).toEqual([
        20, 40,
      ]);
    });

    it('stops at the first page when it already holds a countable completion', async () => {
      await creditExternal(userId, attemptId);
      const lookup = jest.spyOn(
        dataProvider,
        'findActivationSurveyCompletions',
      );

      await coordinator.getStatus(userId);

      expect(lookup).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkAndUnlockStarterPoints', () => {
    beforeEach(async () => {
      await coordinator.grantStarterPoints(userId);
    });

    it('refuses to unlock if demographic profile is incomplete', async () => {
      dataProvider.demographicCompletions.set(userId, false);
      dataProvider.recordCompletion(userId);

      const result = await coordinator.checkAndUnlockStarterPoints(userId);

      expect(result.unlocked).toBe(false);
      expect(result.activationState).toBe('DEMOGRAPHICS_REQUIRED');
      expect(result.missingSteps).toContain(
        'Complete Mandatory Demographic Survey',
      );

      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(100);
      expect(wallet.balance.available).toBe(0);
      expect(notificationRepo.all()).toHaveLength(0);
    });

    it('refuses to unlock if marketplace survey is not completed', async () => {
      dataProvider.demographicCompletions.set(userId, true);

      const result = await coordinator.checkAndUnlockStarterPoints(userId);

      expect(result.unlocked).toBe(false);
      expect(result.missingSteps).toContain('Complete 1 Marketplace Survey');

      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(100);
      expect(wallet.balance.available).toBe(0);
    });

    it('does not unlock on an External completion still under review', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId, {
        source: 'EXTERNAL',
        attemptId: '66666666-6666-4666-8666-666666666666',
        completedAt: new Date(Date.now() - HOUR),
      });
      await creditExternal(userId, '66666666-6666-4666-8666-666666666666');

      const result = await coordinator.checkAndUnlockStarterPoints(userId);

      expect(result.unlocked).toBe(false);
      expect(result.activationState).toBe('PENDING_CONFIRMATION');
      expect(result.reason).toMatch(/48-hour review/i);
      expect((await ledgerService.getWallet(userId)).balance.frozen).toBe(100);
    });

    it('unlocks once the External review window has passed', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId, {
        source: 'EXTERNAL',
        attemptId: '77777777-7777-4777-8777-777777777777',
        completedAt: new Date(Date.now() - 49 * HOUR),
      });
      await creditExternal(userId, '77777777-7777-4777-8777-777777777777');

      const result = await coordinator.checkAndUnlockStarterPoints(userId);

      expect(result.unlocked).toBe(true);
      expect((await ledgerService.getWallet(userId)).balance.available).toBe(
        100,
      );
    });

    it('refuses to unlock if user registration is older than 30 days and no survey was completed in time', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * DAY);
      dataProvider.userRegistrationDates.set(userId, thirtyOneDaysAgo);
      // Completed today — after the 30-day window closed.
      dataProvider.recordCompletion(userId);

      const result = await coordinator.checkAndUnlockStarterPoints(userId);

      expect(result.unlocked).toBe(false);
      expect(result.activationState).toBe('EXPIRED');
      expect(result.reason).toMatch(/expired|window/i);
    });

    it('catches up after the deadline for a survey completed inside the window', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.userRegistrationDates.set(
        userId,
        new Date(Date.now() - 31 * DAY),
      );
      dataProvider.recordCompletion(userId, {
        completedAt: new Date(Date.now() - 2 * DAY),
      });

      const result = await coordinator.checkAndUnlockStarterPoints(userId);

      expect(result.unlocked).toBe(true);
    });

    it('does not catch up past the deadline once the profile is incomplete (Epic 7 review P2, 7.2 AC4)', async () => {
      dataProvider.demographicCompletions.set(userId, false);
      dataProvider.userRegistrationDates.set(
        userId,
        new Date(Date.now() - 31 * DAY),
      );
      dataProvider.recordCompletion(userId, {
        completedAt: new Date(Date.now() - 5 * DAY),
      });
      await coordinator.grantStarterPoints(userId);

      const status = await coordinator.getStatus(userId);
      // Never a READY/ACTIVATED state next to an incomplete profile.
      expect(status.isDemographicComplete).toBe(false);
      expect(status.activationState).toBe('EXPIRED');
      expect(status.unlockEligibility.eligible).toBe(false);

      const result = await coordinator.checkAndUnlockStarterPoints(userId);
      expect(result.unlocked).toBe(false);
      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(100);
      expect(wallet.balance.available).toBe(0);
    });

    it('successfully unlocks 100 points to Available and creates notification when eligible', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);

      const result = await coordinator.checkAndUnlockStarterPoints(userId);

      expect(result.unlocked).toBe(true);
      expect(result.amount).toBe(100);
      expect(result.journalId).toEqual(expect.any(String));
      expect(result.activationState).toBe('ACTIVATED');

      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(100);

      const notifications = notificationRepo.all();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].userId).toBe(userId);
      expect(notifications[0].type).toBe('ACCOUNT_ACTIVATED');
      expect(notifications[0].dedupeKey).toBe(`starter-unlock:${userId}`);
      expect(notifications[0].message).toMatch(/unlocked/i);

      const status = await coordinator.getStatus(userId);
      expect(status.activationState).toBe('ACTIVATED');
      expect(status.activatedAt).not.toBeNull();
      expect(status.unlockEligibility.missingSteps).toEqual([]);
    });

    it('is idempotent on duplicate unlock attempts', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);

      const first = await coordinator.checkAndUnlockStarterPoints(userId);
      expect(first.unlocked).toBe(true);

      const second = await coordinator.checkAndUnlockStarterPoints(userId);
      expect(second.unlocked).toBe(false);
      expect(second.reason).toMatch(/already unlocked/i);
      expect(second.activationState).toBe('ACTIVATED');

      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(100);
      expect(notificationRepo.all()).toHaveLength(1);
    });

    it('posts exactly one unlock when two completions finish simultaneously (FR-8)', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId, { formId: 'form-a' });
      dataProvider.recordCompletion(userId, { formId: 'form-b' });

      const results = await Promise.all([
        coordinator.checkAndUnlockStarterPoints(userId),
        coordinator.checkAndUnlockStarterPoints(userId),
        coordinator.tryUnlockStarterPoints(userId, 'INTERNAL_SUBMISSION'),
      ]);

      const journalIds = new Set(
        results.filter((r) => r.unlocked).map((r) => r.journalId),
      );
      expect(journalIds.size).toBe(1);
      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(100);
      const unlockJournals = (
        await ledgerService.getWallet(userId)
      ).transactions
        .map((t) => t.idempotencyKey)
        .filter((key) => key === `starter-unlock:${userId}`);
      expect(unlockJournals.length).toBeGreaterThan(0);
      expect(
        await ledgerService.findJournalByIdempotencyKey(
          `starter-unlock:${userId}`,
        ),
      ).not.toBeNull();
      expect(activationNotifications()).toHaveLength(1);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('recovers a lost activation notification on a later check', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);
      jest
        .spyOn(notificationRepo, 'createIfAbsent')
        .mockRejectedValueOnce(new Error('notifications unavailable'));

      const result = await coordinator.checkAndUnlockStarterPoints(userId);
      expect(result.unlocked).toBe(true);
      expect(activationNotifications()).toHaveLength(0);

      await coordinator.checkAndUnlockStarterPoints(userId);
      await coordinator.checkAndUnlockStarterPoints(userId);

      expect(activationNotifications()).toHaveLength(1);
      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.available).toBe(100);
    });

    it('unlocks the Frozen points actually held when fewer than 100 were granted', async () => {
      const partialUser = '14141414-1414-4141-8141-141414141414';
      dataProvider.userRegistrationDates.set(partialUser, new Date());
      dataProvider.demographicCompletions.set(partialUser, true);
      dataProvider.recordCompletion(partialUser);
      await coordinator.grantStarterPoints(partialUser, 60);

      const result = await coordinator.checkAndUnlockStarterPoints(partialUser);

      expect(result).toMatchObject({ unlocked: true, amount: 60 });
      const wallet = await ledgerService.getWallet(partialUser);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(60);
    });

    it('unlocks without a notification publisher configured', async () => {
      const silent = new StarterPointsCoordinator(ledgerService, dataProvider);
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);

      await expect(
        silent.checkAndUnlockStarterPoints(userId),
      ).resolves.toMatchObject({ unlocked: true });
    });

    it('refuses to unlock once the expiry journal exists (FR-5 and FR-8 are exclusive)', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);
      await ledgerService.expireStarterPoints(userId);

      const result = await coordinator.checkAndUnlockStarterPoints(userId);

      expect(result.unlocked).toBe(false);
      expect(result.activationState).toBe('EXPIRED');
      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.available).toBe(0);
      expect(activationNotifications()).toHaveLength(0);
    });

    it('reports expiry when the expiry journal wins a race with the unlock', async () => {
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);
      // The sweep commits between our evaluation and the ledger post.
      const realUnlock = ledgerService.unlockStarterPoints.bind(ledgerService);
      jest
        .spyOn(ledgerService, 'unlockStarterPoints')
        .mockImplementationOnce(async (id, amount) => {
          await ledgerService.expireStarterPoints(id);
          return realUnlock(id, amount);
        });

      const result = await coordinator.checkAndUnlockStarterPoints(userId);

      expect(result.unlocked).toBe(false);
      expect(result.activationState).toBe('EXPIRED');
      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(0);
    });
  });

  describe('bounded notification recovery (Epic 9 review P1/P7)', () => {
    let clockNow: Date;
    let clockLedger: LedgerService;
    let publisher: { publish: jest.Mock };
    let recovering: StarterPointsCoordinator;

    beforeEach(() => {
      clockNow = new Date();
      clockLedger = new LedgerService(ledgerRepo, { clock: () => clockNow });
      publisher = { publish: jest.fn(async () => 'CREATED') };
      recovering = new StarterPointsCoordinator(
        clockLedger,
        dataProvider,
        publisher,
        logger,
      );
    });

    function publishedTypes(type: string) {
      return publisher.publish.mock.calls
        .map(([command]) => command as { type: string; dedupeKey: string })
        .filter((command) => command.type === type);
    }

    it('exports a 7-day recovery window', () => {
      expect(NOTIFICATION_RECOVERY_WINDOW_MS).toBe(7 * DAY);
    });

    it('re-publishes the activation notice for an unlock 1 day old', async () => {
      await recovering.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);
      await recovering.checkAndUnlockStarterPoints(userId);
      publisher.publish.mockClear();

      clockNow = new Date(clockNow.getTime() + 1 * DAY);
      const result = await recovering.checkAndUnlockStarterPoints(userId);

      expect(result.activationState).toBe('ACTIVATED');
      expect(publishedTypes('ACCOUNT_ACTIVATED')).toEqual([
        expect.objectContaining({ dedupeKey: `starter-unlock:${userId}` }),
      ]);
    });

    it('does not call the publisher for an unlock 8 days old', async () => {
      await recovering.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);
      await recovering.checkAndUnlockStarterPoints(userId);
      publisher.publish.mockClear();

      clockNow = new Date(clockNow.getTime() + 8 * DAY);
      const result = await recovering.tryUnlockStarterPoints(
        userId,
        'INTERNAL_SUBMISSION',
      );

      expect(result.activationState).toBe('ACTIVATED');
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('recovers an expiry WARNING whose sweep publish failed, exactly once', async () => {
      const expiredUser = '55555555-5555-4555-8555-555555555555';
      dataProvider.userRegistrationDates.delete(userId);
      dataProvider.userRegistrationDates.set(
        expiredUser,
        new Date(Date.now() - 35 * DAY),
      );
      await coordinator.grantStarterPoints(expiredUser);
      jest
        .spyOn(notificationRepo, 'createIfAbsent')
        .mockRejectedValueOnce(new Error('notifications unavailable'));

      const sweep = await coordinator.expireUnmaturedStarterPoints();
      expect(sweep.expiredUserIds).toEqual([expiredUser]);
      const warnings = () =>
        notificationRepo
          .all()
          .filter((n) => n.userId === expiredUser && n.type === 'WARNING');
      expect(warnings()).toHaveLength(0);

      await coordinator.tryUnlockStarterPoints(expiredUser, 'DEMOGRAPHICS');
      await coordinator.tryUnlockStarterPoints(expiredUser, 'MANUAL');

      expect(warnings()).toHaveLength(1);
      expect(warnings()[0].dedupeKey).toBe(`starter-expiry:${expiredUser}`);
      expect(warnings()[0].message).toMatch(/^Your 100 frozen starter points/);
    });

    it('does not re-publish the expiry WARNING outside the window', async () => {
      await recovering.grantStarterPoints(userId);
      await clockLedger.expireStarterPoints(userId);

      clockNow = new Date(clockNow.getTime() + 8 * DAY);
      const result = await recovering.tryUnlockStarterPoints(userId, 'MANUAL');

      expect(result.activationState).toBe('EXPIRED');
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('publishes the expiry WARNING when the expiry wins the race with the unlock', async () => {
      await recovering.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);
      const realUnlock = clockLedger.unlockStarterPoints.bind(clockLedger);
      jest
        .spyOn(clockLedger, 'unlockStarterPoints')
        .mockImplementationOnce(async (id, amount) => {
          await clockLedger.expireStarterPoints(id);
          return realUnlock(id, amount);
        });

      const result = await recovering.checkAndUnlockStarterPoints(userId);

      expect(result.activationState).toBe('EXPIRED');
      expect(publishedTypes('WARNING')).toEqual([
        expect.objectContaining({ dedupeKey: `starter-expiry:${userId}` }),
      ]);
    });
  });

  describe('tryUnlockStarterPoints', () => {
    it('never throws and logs the failure so a later trigger can retry', async () => {
      await coordinator.grantStarterPoints(userId);
      dataProvider.demographicCompletions.set(userId, true);
      dataProvider.recordCompletion(userId);
      jest
        .spyOn(ledgerService, 'unlockStarterPoints')
        .mockRejectedValueOnce(new Error('database unavailable'));

      const result = await coordinator.tryUnlockStarterPoints(
        userId,
        'INTERNAL_SUBMISSION',
      );

      expect(result.unlocked).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/INTERNAL_SUBMISSION.*database unavailable/),
      );

      // Retry succeeds.
      await expect(
        coordinator.tryUnlockStarterPoints(userId, 'MANUAL'),
      ).resolves.toMatchObject({ unlocked: true });
    });

    it('never throws even when the data provider fails', async () => {
      jest
        .spyOn(dataProvider, 'isDemographicComplete')
        .mockRejectedValueOnce(new Error('profile lookup failed'));

      await expect(
        coordinator.tryUnlockStarterPoints(userId, 'DEMOGRAPHICS'),
      ).resolves.toMatchObject({ unlocked: false });
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('unlock vs expiry at the ledger (exactly one applies)', () => {
    it('lets only one of the two journals post when they race', async () => {
      await coordinator.grantStarterPoints(userId);

      const [unlock, expiry] = await Promise.allSettled([
        ledgerService.unlockStarterPoints(userId),
        ledgerService.expireStarterPoints(userId),
      ]);

      const unlockPosted =
        unlock.status === 'fulfilled' && unlock.value !== null;
      const expiryPosted =
        expiry.status === 'fulfilled' && expiry.value !== null;
      expect(unlockPosted !== expiryPosted).toBe(true);
      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(unlockPosted ? 100 : 0);
    });
  });

  describe('expireUnmaturedStarterPoints', () => {
    it('voids frozen points to SYSTEM_SINK for accounts older than 30 days with incomplete onboarding', async () => {
      const expiredUser = '22222222-2222-4222-8222-222222222222';
      const thirtyFiveDaysAgo = new Date(Date.now() - 35 * DAY);
      dataProvider.userRegistrationDates.delete(userId);
      dataProvider.userRegistrationDates.set(expiredUser, thirtyFiveDaysAgo);
      dataProvider.demographicCompletions.set(expiredUser, false);

      await coordinator.grantStarterPoints(expiredUser);

      const result = await coordinator.expireUnmaturedStarterPoints();

      expect(result.scannedCount).toBe(1);
      expect(result.expiredCount).toBe(1);
      expect(result.expiredUserIds).toContain(expiredUser);
      expect(result.totalPointsVoided).toBe(100);
      expect(result.unlockedUserIds).toEqual([]);
      expect(result.deferredCount).toBe(0);
      expect(result.failedCount).toBe(0);

      const wallet = await ledgerService.getWallet(expiredUser);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(0);

      const notification = notificationRepo
        .all()
        .find((n) => n.userId === expiredUser);
      expect(notification).toBeDefined();
      expect(notification?.type).toBe('WARNING');
      expect(notification?.dedupeKey).toBe(`starter-expiry:${expiredUser}`);
      expect(notification?.message).toMatch(/expired/i);

      // A second sweep does not expire or count the user again.
      const again = await coordinator.expireUnmaturedStarterPoints();
      expect(again.expiredCount).toBe(0);
    });

    it('states the amount actually voided in the expiry notification', async () => {
      const partialUser = '44444444-4444-4444-8444-444444444444';
      dataProvider.userRegistrationDates.set(
        partialUser,
        new Date(Date.now() - 35 * DAY),
      );
      await coordinator.grantStarterPoints(partialUser, 60);

      const result = await coordinator.expireUnmaturedStarterPoints();

      expect(result.totalPointsVoided).toBe(60);
      const notification = notificationRepo
        .all()
        .find((n) => n.userId === partialUser);
      expect(notification?.message).toMatch(/^Your 60 frozen starter points/);
    });

    it('unlocks (catch-up) instead of expiring a user who completed a survey inside the window', async () => {
      const eligibleUser = '33333333-3333-4333-8333-333333333333';
      const thirtyFiveDaysAgo = new Date(Date.now() - 35 * DAY);
      dataProvider.userRegistrationDates.set(eligibleUser, thirtyFiveDaysAgo);
      dataProvider.demographicCompletions.set(eligibleUser, true);
      dataProvider.recordCompletion(eligibleUser, {
        completedAt: new Date(Date.now() - 20 * DAY),
      });

      await coordinator.grantStarterPoints(eligibleUser);

      const result = await coordinator.expireUnmaturedStarterPoints();

      expect(result.expiredCount).toBe(0);
      expect(result.expiredUserIds).not.toContain(eligibleUser);
      expect(result.unlockedUserIds).toEqual([eligibleUser]);

      const wallet = await ledgerService.getWallet(eligibleUser);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(100);
      expect(activationNotifications(eligibleUser)).toHaveLength(1);
    });

    it('expires a user whose only survey was completed after the window', async () => {
      const lateUser = '55555555-5555-4555-8555-555555555555';
      dataProvider.userRegistrationDates.set(
        lateUser,
        new Date(Date.now() - 35 * DAY),
      );
      dataProvider.demographicCompletions.set(lateUser, true);
      dataProvider.recordCompletion(lateUser, {
        completedAt: new Date(Date.now() - 2 * DAY),
      });
      await coordinator.grantStarterPoints(lateUser);

      const result = await coordinator.expireUnmaturedStarterPoints();

      expect(result.expiredUserIds).toEqual([lateUser]);
      expect((await ledgerService.getWallet(lateUser)).balance.available).toBe(
        0,
      );
    });

    it('defers a user whose in-window External survey is still under review', async () => {
      const pendingUser = '66666666-6666-4666-8666-666666666666';
      const registeredAt = new Date(Date.now() - 30 * DAY - HOUR);
      dataProvider.userRegistrationDates.set(pendingUser, registeredAt);
      dataProvider.demographicCompletions.set(pendingUser, true);
      dataProvider.recordCompletion(pendingUser, {
        source: 'EXTERNAL',
        attemptId: '88888888-8888-4888-8888-888888888888',
        completedAt: new Date(Date.now() - 2 * HOUR),
      });
      await creditExternal(pendingUser, '88888888-8888-4888-8888-888888888888');
      await coordinator.grantStarterPoints(pendingUser);

      const result = await coordinator.expireUnmaturedStarterPoints();

      expect(result.deferredCount).toBe(1);
      expect(result.expiredUserIds).toEqual([]);
      expect((await ledgerService.getWallet(pendingUser)).balance.frozen).toBe(
        100,
      );
    });

    it('expires, and does not unlock, a past-deadline user whose in-window completion stands next to an incomplete profile (Epic 7 review P2)', async () => {
      const clearedUser = '99999999-9999-4999-8999-999999999999';
      dataProvider.userRegistrationDates.set(
        clearedUser,
        new Date(Date.now() - 35 * DAY),
      );
      // The profile was cleared after the in-window Internal completion.
      dataProvider.demographicCompletions.set(clearedUser, false);
      dataProvider.recordCompletion(clearedUser, {
        completedAt: new Date(Date.now() - 20 * DAY),
      });
      await coordinator.grantStarterPoints(clearedUser);

      const result = await coordinator.expireUnmaturedStarterPoints();

      expect(result.unlockedUserIds).toEqual([]);
      expect(result.expiredUserIds).toEqual([clearedUser]);
      const wallet = await ledgerService.getWallet(clearedUser);
      expect(wallet.balance.frozen).toBe(0);
      expect(wallet.balance.available).toBe(0);
      expect(activationNotifications(clearedUser)).toHaveLength(0);
    });

    it('skips activated users and users still inside their own 30-day window', async () => {
      const activated = '77777777-7777-4777-8777-777777777777';
      dataProvider.userRegistrationDates.set(
        activated,
        new Date(Date.now() - 40 * DAY),
      );
      dataProvider.demographicCompletions.set(activated, true);
      dataProvider.recordCompletion(activated, {
        completedAt: new Date(Date.now() - 39 * DAY),
      });
      await coordinator.grantStarterPoints(activated);
      await coordinator.checkAndUnlockStarterPoints(activated);

      const fresh = '99999999-9999-4999-8999-999999999999';
      dataProvider.userRegistrationDates.set(
        fresh,
        new Date(Date.now() - 2 * DAY),
      );
      await coordinator.grantStarterPoints(fresh);

      // An admin cutoff of "now" can only narrow the sweep, never expire a
      // user who is still inside their own window.
      const result = await coordinator.expireUnmaturedStarterPoints(new Date());

      expect(result.expiredUserIds).toEqual([]);
      expect(result.unlockedUserIds).toEqual([]);
      expect((await ledgerService.getWallet(fresh)).balance.frozen).toBe(100);
      expect((await ledgerService.getWallet(activated)).balance.available).toBe(
        100,
      );
    });

    it('keeps sweeping when one user fails and counts the failure', async () => {
      const failing = '12121212-1212-4121-8121-121212121212';
      const expiring = '13131313-1313-4131-8131-131313131313';
      for (const id of [failing, expiring]) {
        dataProvider.userRegistrationDates.set(
          id,
          new Date(Date.now() - 35 * DAY),
        );
        await coordinator.grantStarterPoints(id);
      }
      dataProvider.userRegistrationDates.delete(userId);
      const realExpire = ledgerService.expireStarterPoints.bind(ledgerService);
      jest
        .spyOn(ledgerService, 'expireStarterPoints')
        .mockImplementation(async (id, amount) => {
          if (id === failing) throw new Error('lock timeout');
          return realExpire(id, amount);
        });

      const result = await coordinator.expireUnmaturedStarterPoints();

      expect(result.failedCount).toBe(1);
      expect(result.expiredUserIds).toEqual([expiring]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(failing),
      );
    });

    describe('bounded batches (limit + cursor)', () => {
      const users = {
        oldest: 'a0000000-0000-4000-8000-000000000003',
        tieLow: 'a0000000-0000-4000-8000-000000000001',
        tieHigh: 'a0000000-0000-4000-8000-000000000002',
        newest: 'a0000000-0000-4000-8000-000000000000',
      };

      async function seedExpiring(id: string, registeredAt: Date) {
        dataProvider.userRegistrationDates.set(id, registeredAt);
        await coordinator.grantStarterPoints(id);
      }

      it('scans oldest registration first, (registeredAt, userId), across pages without gaps or repeats', async () => {
        const tie = new Date(Date.now() - 40 * DAY);
        await seedExpiring(users.oldest, new Date(Date.now() - 50 * DAY));
        await seedExpiring(users.tieHigh, tie);
        await seedExpiring(users.tieLow, tie);
        await seedExpiring(users.newest, new Date(Date.now() - 35 * DAY));

        const first = await coordinator.expireUnmaturedStarterPoints(
          undefined,
          { limit: 2 },
        );
        expect(first.scannedCount).toBe(2);
        expect(first.expiredUserIds).toEqual([users.oldest, users.tieLow]);
        expect(first.nextCursor).toEqual(expect.any(String));

        const second = await coordinator.expireUnmaturedStarterPoints(
          undefined,
          { limit: 2, after: first.nextCursor! },
        );
        expect(second.scannedCount).toBe(2);
        expect(second.expiredUserIds).toEqual([users.tieHigh, users.newest]);
        // A full page cannot know it was the last one.
        expect(second.nextCursor).toEqual(expect.any(String));

        const third = await coordinator.expireUnmaturedStarterPoints(
          undefined,
          { limit: 2, after: second.nextCursor! },
        );
        expect(third.scannedCount).toBe(0);
        expect(third.nextCursor).toBeNull();

        for (const id of Object.values(users)) {
          expect((await ledgerService.getWallet(id)).balance.frozen).toBe(0);
        }
        expect(first.totalPointsVoided + second.totalPointsVoided).toBe(400);
      });

      it('returns a null cursor when the batch is not full', async () => {
        await seedExpiring(users.oldest, new Date(Date.now() - 50 * DAY));

        const result = await coordinator.expireUnmaturedStarterPoints();

        expect(result.scannedCount).toBe(1);
        expect(result.expiredUserIds).toEqual([users.oldest]);
        expect(result.nextCursor).toBeNull();
      });

      it('moves past deferred and failed users instead of rescanning them', async () => {
        // Oldest first: failing (31 d), deferred (30 d 1 h), expiring (30 d 30 min).
        const failing = 'b0000000-0000-4000-8000-000000000001';
        await seedExpiring(failing, new Date(Date.now() - 31 * DAY));
        const deferred = 'b0000000-0000-4000-8000-000000000002';
        await seedExpiring(deferred, new Date(Date.now() - 30 * DAY - HOUR));
        dataProvider.demographicCompletions.set(deferred, true);
        dataProvider.recordCompletion(deferred, {
          source: 'EXTERNAL',
          attemptId: '99999999-0000-4000-8000-000000000001',
          completedAt: new Date(Date.now() - 2 * HOUR),
        });
        await creditExternal(deferred, '99999999-0000-4000-8000-000000000001');
        const expiring = 'b0000000-0000-4000-8000-000000000003';
        await seedExpiring(
          expiring,
          new Date(Date.now() - 30 * DAY - 30 * 60 * 1000),
        );
        const realExpire =
          ledgerService.expireStarterPoints.bind(ledgerService);
        jest
          .spyOn(ledgerService, 'expireStarterPoints')
          .mockImplementation(async (id, amount) => {
            if (id === failing) throw new Error('lock timeout');
            return realExpire(id, amount);
          });

        const first = await coordinator.expireUnmaturedStarterPoints(
          undefined,
          { limit: 1 },
        );
        expect(first).toMatchObject({ scannedCount: 1, failedCount: 1 });

        const second = await coordinator.expireUnmaturedStarterPoints(
          undefined,
          { limit: 1, after: first.nextCursor! },
        );
        expect(second).toMatchObject({
          scannedCount: 1,
          deferredCount: 1,
          failedCount: 0,
        });

        const third = await coordinator.expireUnmaturedStarterPoints(
          undefined,
          { limit: 1, after: second.nextCursor! },
        );
        expect(third.expiredUserIds).toEqual([expiring]);

        const fourth = await coordinator.expireUnmaturedStarterPoints(
          undefined,
          { limit: 1, after: third.nextCursor! },
        );
        expect(fourth.scannedCount).toBe(0);
        expect(fourth.nextCursor).toBeNull();
      });

      it('rejects an invalid batch size or cursor', async () => {
        for (const batch of [
          { limit: 0 },
          { limit: 501 },
          { after: 'not-a-cursor' },
        ]) {
          await expect(
            coordinator.expireUnmaturedStarterPoints(undefined, batch),
          ).rejects.toBeInstanceOf(InvalidLedgerOperationException);
        }
      });
    });
  });
});
