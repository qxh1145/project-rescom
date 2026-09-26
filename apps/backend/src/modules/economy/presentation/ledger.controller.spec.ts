import { LedgerController } from './ledger.controller';
import { LedgerService } from '../application/ledger.service';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { RewardSettlementCoordinator } from '../application/reward-settlement.coordinator';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { InMemoryNotificationRepository } from '../../notifications/infrastructure/in-memory-notification.repository';
import { ROLES_KEY } from '../../auth/presentation/decorators/roles.decorator';

const HOUR_MS = 60 * 60 * 1000;

describe('LedgerController', () => {
  let controller: LedgerController;
  let service: LedgerService;
  let repo: InMemoryLedgerRepository;

  const mockUser: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    role: 'RESPONDENT',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    repo = new InMemoryLedgerRepository();
    service = new LedgerService(repo);
    controller = new LedgerController(service);
  });

  it('posts a journal via endpoint and returns standard success envelope', async () => {
    const sys = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
    const userAcc = await service.getOrCreateAccount(
      mockUser.id,
      'USER_AVAILABLE',
    );

    const res = await controller.postJournal({
      idempotencyKey: 'ctrl-tx-1',
      description: 'Test issuance',
      entries: [
        { accountId: sys.id, amount: -100 },
        { accountId: userAcc.id, amount: 100 },
      ],
    });

    expect(res.data).toBeDefined();
    expect(res.data?.idempotencyKey).toBe('ctrl-tx-1');
    expect(res.data?.entries).toHaveLength(2);
    expect(res.error).toBeNull();
  });

  it('reverses a journal via endpoint and returns standard success envelope', async () => {
    const sys = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
    const userAcc = await service.getOrCreateAccount(
      mockUser.id,
      'USER_AVAILABLE',
    );

    const postRes = await controller.postJournal({
      idempotencyKey: 'ctrl-tx-rev',
      entries: [
        { accountId: sys.id, amount: -200 },
        { accountId: userAcc.id, amount: 200 },
      ],
    });

    const revRes = await controller.reverseJournal(postRes.data!.id, {
      reason: 'Reversal test',
    });

    expect(revRes.data?.reversesJournalId).toBe(postRes.data!.id);
    expect(revRes.data?.entries).toHaveLength(2);
    expect(revRes.error).toBeNull();
  });

  it('gets my accounts for current user', async () => {
    await service.getOrCreateAccount(mockUser.id, 'USER_AVAILABLE');
    await service.getOrCreateAccount(mockUser.id, 'FROZEN');

    const res = await controller.getMyAccounts(mockUser);
    expect(res.data).toHaveLength(2);
    expect(res.error).toBeNull();
  });

  it('gets wallet aggregate with all balances and transactions for current user', async () => {
    const sys = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
    const userAcc = await service.getOrCreateAccount(
      mockUser.id,
      'USER_AVAILABLE',
    );

    await service.transfer({
      fromAccountId: sys.id,
      toAccountId: userAcc.id,
      amount: 150,
      idempotencyKey: 'ctrl-wallet-tx',
      description: 'Survey reward',
    });

    const res = await controller.getWallet(mockUser);
    expect(res.data).toBeDefined();
    expect(res.data?.balance.available).toBe(150);
    expect(res.data?.balance.total).toBe(150);
    expect(res.data?.transactions).toHaveLength(1);
    expect(res.data?.transactions[0].description).toBe('Survey reward');
    expect(res.data?.accounts).toHaveLength(5);
    expect(res.error).toBeNull();
  });

  it('verifies balance and audits ledger integrity', async () => {
    const sys = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
    const userAcc = await service.getOrCreateAccount(
      mockUser.id,
      'USER_AVAILABLE',
    );

    await service.transfer({
      fromAccountId: sys.id,
      toAccountId: userAcc.id,
      amount: 100,
      idempotencyKey: 'tx-audit',
    });

    const balanceRes = await controller.getAccountBalance(userAcc.id);
    expect(balanceRes.data?.projectedBalance).toBe(100);
    expect(balanceRes.data?.isConsistent).toBe(true);

    const integrityRes = await controller.verifyLedgerIntegrity();
    expect(integrityRes.data?.isZeroSum).toBe(true);
    expect(integrityRes.data?.totalSystemBalance).toBe(0);
  });

  describe('Reward Settlement Endpoints (Story 6.4, Epic 6 review P1/P2)', () => {
    const publisherId = '22222222-2222-4222-8222-222222222222';
    const attemptId = '44444444-4444-4444-8444-444444444444';
    const creditTime = new Date('2026-09-20T08:00:00.000Z');
    let now: Date;
    const admin: AuthenticatedUser = {
      ...mockUser,
      id: '77777777-7777-4777-8777-777777777777',
      role: 'ADMIN',
    };

    beforeEach(async () => {
      now = creditTime;
      service = new LedgerService(repo, { clock: () => now });
      controller = new LedgerController(service);
      // Seed publisher escrow with 200 points
      const sys = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const publisherEscrow = await service.getOrCreateAccount(
        publisherId,
        'ESCROW',
      );
      await service.postJournal({
        idempotencyKey: 'ctrl-seed-escrow',
        entries: [
          { accountId: sys.id, amount: -200 },
          { accountId: publisherEscrow.id, amount: 200 },
        ],
      });
      await service.creditPendingReward({
        attemptId,
        publisherId,
        respondentId: mockUser.id,
        amount: 20,
      });
    });

    it('no longer exposes the body-driven credit endpoints (moved to the Admin re-drive controller)', () => {
      expect((controller as any).creditInternalReward).toBeUndefined();
      expect((controller as any).creditPendingReward).toBeUndefined();
    });

    it('releases the caller’s own matured pending reward', async () => {
      now = new Date(creditTime.getTime() + 48 * HOUR_MS);

      const res = await controller.releasePendingReward(
        attemptId,
        {},
        mockUser,
      );

      expect(res.data?.idempotencyKey).toBe(`release-pending:${attemptId}`);
      expect(res.error).toBeNull();

      const wallet = await service.getWallet(mockUser.id);
      expect(wallet.balance.pending).toBe(0);
      expect(wallet.balance.available).toBe(20);
    });

    it('refuses an immediate release with PENDING_REWARD_NOT_MATURED', async () => {
      await expect(
        controller.releasePendingReward(attemptId, {}, mockUser),
      ).rejects.toMatchObject({ code: 'PENDING_REWARD_NOT_MATURED' });

      const wallet = await service.getWallet(mockUser.id);
      expect(wallet.balance.pending).toBe(20);
    });

    it("forbids a non-admin from releasing another respondent's pending reward, whatever the body says", async () => {
      now = new Date(creditTime.getTime() + 48 * HOUR_MS);
      const other: AuthenticatedUser = {
        ...mockUser,
        id: '99999999-9999-4999-8999-999999999999',
      };

      await expect(
        controller.releasePendingReward(
          attemptId,
          { respondentId: mockUser.id },
          other,
        ),
      ).rejects.toMatchObject({ code: 'PENDING_REWARD_FORBIDDEN' });
    });

    it('lets an Admin release any matured credit, optionally naming the respondent', async () => {
      now = new Date(creditTime.getTime() + 48 * HOUR_MS);

      await expect(
        controller.releasePendingReward(
          attemptId,
          { respondentId: publisherId },
          admin,
        ),
      ).rejects.toMatchObject({ code: 'PENDING_REWARD_FORBIDDEN' });

      const res = await controller.releasePendingReward(
        attemptId,
        { respondentId: mockUser.id },
        admin,
      );
      expect(res.data?.idempotencyKey).toBe(`release-pending:${attemptId}`);
    });

    it('runs the matured-release scan with a clamped cutoff (Admin only)', async () => {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          LedgerController.prototype.releaseMaturedPendingRewards,
        ),
      ).toEqual(['ADMIN']);

      now = new Date(creditTime.getTime() + 47 * HOUR_MS);
      const early = await controller.releaseMaturedPendingRewards({
        cutoffDate: new Date(creditTime.getTime() + 10 * HOUR_MS).toISOString(),
      });
      expect(early.data).toMatchObject({ processed: 0, releasedCount: 0 });

      now = new Date(creditTime.getTime() + 49 * HOUR_MS);
      const res = await controller.releaseMaturedPendingRewards({ limit: 10 });
      expect(res.data).toMatchObject({
        processed: 1,
        releasedCount: 1,
        hasMore: false,
      });
    });

    it('routes the release through the settlement coordinator so the respondent is notified (Story 9.6)', async () => {
      const notificationRepo = new InMemoryNotificationRepository();
      const notifyingController = new LedgerController(
        service,
        new RewardSettlementCoordinator(
          service,
          new NotificationsService(notificationRepo),
        ),
      );
      now = new Date(creditTime.getTime() + 48 * HOUR_MS);

      const res = await notifyingController.releasePendingReward(
        attemptId,
        {},
        mockUser,
      );

      expect(res.data?.idempotencyKey).toBe(`release-pending:${attemptId}`);
      expect(notificationRepo.all()).toEqual([
        expect.objectContaining({
          userId: mockUser.id,
          type: 'REWARD_RELEASED',
          dedupeKey: `release-pending:${attemptId}`,
        }),
      ]);
    });
  });
});
