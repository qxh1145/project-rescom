import { randomUUID } from 'crypto';
import {
  POINT_VND_RATE,
  TOP_UP_REFUND_CHANGED_EVENT_TYPE,
  TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE,
} from '@rescom/schemas';
import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { InMemoryPayosTopUpRepository } from '../infrastructure/in-memory-payos-top-up.repository';
import { LedgerService } from './ledger.service';
import { TopUpRefundService } from './top-up-refund.service';
import { PayosTopUpService } from './payos-top-up.service';
import { FakePaymentProvider } from '../infrastructure/fake-payment-provider';
import { PAYOS_TEST_CHECKSUM_KEY } from '../../../../test/fixtures/payos-webhook.fixture';
import {
  RefundAlreadyResolvedException,
  TopUpRefundAlreadyRequestedException,
  TopUpRequestNotFoundException,
} from './exceptions/economy.exceptions';
import { TopUpRefundNotificationHandler } from './top-up-refund-notification.handler';
import { TopUpRefundAdminNoticeHandler } from '../infrastructure/top-up-refund-admin-notice.handler';

describe('TopUpRefundService & Handlers', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const adminId = '33333333-3333-4333-8333-333333333333';

  let repository: InMemoryPayosTopUpRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let refundService: TopUpRefundService;
  let payosService: PayosTopUpService;
  let currentTime: Date;

  beforeEach(() => {
    currentTime = new Date('2026-10-16T12:00:00.000Z');
    repository = new InMemoryPayosTopUpRepository();
    repository.userEmails.set(userId, 'user@example.com');
    ledgerRepo = new InMemoryLedgerRepository();
    ledgerService = new LedgerService(ledgerRepo, {
      clock: () => currentTime,
    });
    refundService = new TopUpRefundService({
      repository,
      ledgerService,
      unitOfWork: new PassThroughUnitOfWork(),
      logger: { warn: jest.fn(), log: jest.fn() },
      now: () => currentTime,
    });
    payosService = new PayosTopUpService({
      repository,
      provider: new FakePaymentProvider(PAYOS_TEST_CHECKSUM_KEY),
      unitOfWork: new PassThroughUnitOfWork(),
      ledgerService,
      appBaseUrl: 'http://localhost:3000',
      limit: 5,
      windowSeconds: 600,
      logger: { warn: jest.fn(), log: jest.fn() },
      now: () => currentTime,
    });
  });

  async function createSuccessfulTopUp(opts?: {
    id?: string;
    targetUserId?: string;
    points?: number;
    amountVnd?: number;
    paidAt?: Date;
    counterAccountNumber?: string | null;
    counterAccountName?: string | null;
    counterAccountBankId?: string | null;
    counterAccountBankName?: string | null;
    isMismatchCredit?: boolean;
    channel?: 'PAYOS' | 'MANUAL';
    status?: any;
  }) {
    const id = opts?.id ?? randomUUID();
    const targetUid = opts?.targetUserId ?? userId;
    const points = opts?.points ?? 100;
    const amountVnd = opts?.amountVnd ?? points * POINT_VND_RATE;
    const paidAt = opts?.paidAt ?? new Date(currentTime.getTime() - 3_600_000); // 1 hr ago
    const channel = opts?.channel ?? 'PAYOS';
    const status = opts?.status ?? 'SUCCESSFUL';

    let journalId: string | null = null;
    if (status === 'SUCCESSFUL') {
      const journal = opts?.isMismatchCredit
        ? await ledgerService.creditMismatchTopUp({
            topUpId: id,
            userId: targetUid,
            points,
            orderCode: 999001,
            amountPaidVnd: amountVnd,
          })
        : await ledgerService.creditPayosTopUp({
            topUpId: id,
            userId: targetUid,
            points,
            orderCode: 999001,
          });
      journalId = journal.id;
      repository.creditJournals.set(journal.id, {
        id: journal.id,
        idempotencyKey: journal.idempotencyKey,
        createdAt: journal.createdAt,
      });
    }

    const row = {
      id,
      userId: targetUid,
      orderCode: 999001,
      amountVnd,
      points,
      status,
      checkoutUrl: null,
      paymentLinkId: 'link_1',
      expiresAt: new Date(currentTime.getTime() + 600_000),
      cancelledAt: null,
      paidAt: status === 'SUCCESSFUL' ? paidAt : null,
      journalId,
      pointsCredited: status === 'SUCCESSFUL' ? points : null,
      amountPaidVnd: status === 'SUCCESSFUL' ? amountVnd : null,
      providerReference: 'ref_1',
      counterAccountBankId:
        opts?.counterAccountBankId !== undefined
          ? opts.counterAccountBankId
          : '970422',
      counterAccountBankName:
        opts?.counterAccountBankName !== undefined
          ? opts.counterAccountBankName
          : 'MB Bank',
      counterAccountName:
        opts?.counterAccountName !== undefined
          ? opts.counterAccountName
          : 'NGUYEN VAN A',
      counterAccountNumber:
        opts?.counterAccountNumber !== undefined
          ? opts.counterAccountNumber
          : '0123456789',
      createdAt: new Date(paidAt.getTime() - 60_000),
      channel,
    };

    if (channel === 'PAYOS') {
      repository.rows.set(id, row as any);
    } else {
      repository.manualTopUps.set(id, row as any);
    }

    return row;
  }

  describe('submitRefund', () => {
    it('creates an ELIGIBLE refund request and places hold on Available points', async () => {
      const topUp = await createSuccessfulTopUp({ points: 250 });

      const walletBefore = await ledgerService.getWallet(userId);
      expect(walletBefore.balance.available).toBe(250);
      expect(walletBefore.balance.refundHold).toBe(0);

      const result = await refundService.submitRefund(
        topUp.id,
        {
          reason: 'WRONG_AMOUNT',
          note: 'I typed the wrong amount.',
        },
        { userId, correlationId: randomUUID() },
      );

      expect(result.replayed).toBe(false);
      expect(result.request.status).toBe('REQUESTED');
      expect(result.request.eligibility).toBe('ELIGIBLE');
      expect(result.request.ineligibleReason).toBeNull();
      expect(result.request.points).toBe(250);
      expect(result.request.amountVnd).toBe(50_000);
      expect(result.request.destination).toEqual({
        bankId: '970422',
        bankName: 'MB Bank',
        holderName: 'NGUYEN VAN A',
        last4: '6789',
        accountNumber: '0123456789',
        verified: true,
      });

      // Wallet balance updated: available moved to refundHold
      const walletAfter = await ledgerService.getWallet(userId);
      expect(walletAfter.balance.available).toBe(0);
      expect(walletAfter.balance.refundHold).toBe(250);
      expect(walletAfter.balance.total).toBe(0); // refundHold excluded from total

      // Outbox events emitted
      expect(repository.refundEvents).toHaveLength(2);
      const userEvent = repository.refundEvents.find(
        (e) => e.eventType === TOP_UP_REFUND_CHANGED_EVENT_TYPE,
      );
      const adminEvent = repository.refundEvents.find(
        (e) => e.eventType === TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE,
      );

      expect(userEvent).toBeDefined();
      expect(userEvent?.payload).toMatchObject({
        schemaVersion: 1,
        topUpId: topUp.id,
        userId,
        status: 'REQUESTED',
        eligibility: 'ELIGIBLE',
        points: 250,
      });

      expect(adminEvent).toBeDefined();
      expect(adminEvent?.payload).toMatchObject({
        schemaVersion: 1,
        topUpId: topUp.id,
        userEmail: 'user@example.com',
        destination: {
          last4: '6789',
          verified: true,
        },
      });
      // Ensure full account number is never in payload
      expect(JSON.stringify(adminEvent?.payload)).not.toContain('0123456789');
    });

    it('sets destinationVerified=false when holder name is null (probe shape)', async () => {
      const topUp = await createSuccessfulTopUp({
        counterAccountName: null,
        counterAccountBankName: null,
      });

      const result = await refundService.submitRefund(
        topUp.id,
        {
          reason: 'NO_LONGER_NEEDED',
          note: 'No longer needed',
        },
        { userId },
      );

      expect(result.request.destination.verified).toBe(false);
      expect(result.request.destination.holderName).toBeNull();
      expect(result.request.destination.last4).toBe('6789');
    });

    it('marks request NOT_ELIGIBLE with SPENT_SINCE_TOP_UP if spend occurred after credit', async () => {
      const topUp = await createSuccessfulTopUp({ points: 500 });

      // Simulate spending 100 points on survey publishing after credit
      await ledgerService.reserveEscrow({
        formVersionId: randomUUID(),
        userId,
        amount: 100,
        formTitle: 'Market survey',
      });

      const result = await refundService.submitRefund(
        topUp.id,
        {
          reason: 'OTHER',
          note: 'Mistaken top-up',
        },
        { userId },
      );

      expect(result.request.status).toBe('REQUESTED');
      expect(result.request.eligibility).toBe('NOT_ELIGIBLE');
      expect(result.request.ineligibleReason).toBe('SPENT_SINCE_TOP_UP');

      // No hold journal posted; Available balance unchanged
      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.available).toBe(400);
      expect(wallet.balance.refundHold).toBe(0);
    });

    it('marks NOT_ELIGIBLE with SPENT_SINCE_TOP_UP even if Available is still >= topup points', async () => {
      // User has 1000 points, tops up 100 points, spends 50 points -> still has 1050 > 100, but spent since top-up
      const topUp = await createSuccessfulTopUp({ points: 100 });

      // Add extra points
      await ledgerService.creditPayosTopUp({
        topUpId: randomUUID(),
        userId,
        points: 1000,
        orderCode: 999002,
      });

      // Spend 50 points
      await ledgerService.spendPoints({
        userId,
        amount: 50,
        idempotencyKey: `redemption:${userId}:${randomUUID()}`,
      });

      const result = await refundService.submitRefund(
        topUp.id,
        {
          reason: 'WRONG_AMOUNT',
          note: 'wrong amount',
        },
        { userId },
      );

      expect(result.request.eligibility).toBe('NOT_ELIGIBLE');
      expect(result.request.ineligibleReason).toBe('SPENT_SINCE_TOP_UP');
    });

    it('marks NOT_ELIGIBLE with INSUFFICIENT_AVAILABLE if balance < points without recent spend', async () => {
      const topUp = await createSuccessfulTopUp({ points: 500 });

      // Debit user available directly or P2P transfer (which is non-spend)
      const userAcc = await ledgerService.getOrCreateAccount(
        userId,
        'USER_AVAILABLE',
      );
      const otherAcc = await ledgerService.getOrCreateAccount(
        otherUserId,
        'USER_AVAILABLE',
      );
      await ledgerService.transfer({
        fromAccountId: userAcc.id,
        toAccountId: otherAcc.id,
        amount: 300,
        idempotencyKey: `transfer:${randomUUID()}`,
      });

      const result = await refundService.submitRefund(
        topUp.id,
        {
          reason: 'WRONG_AMOUNT',
          note: 'wrong amount',
        },
        { userId },
      );

      expect(result.request.eligibility).toBe('NOT_ELIGIBLE');
      expect(result.request.ineligibleReason).toBe('INSUFFICIENT_AVAILABLE');
    });

    it('treats a voucher redemption that was later reversed as still counting as spend', async () => {
      const topUp = await createSuccessfulTopUp({ points: 200 });

      const redemptionKey = `redemption:${userId}:${randomUUID()}`;
      const spendJournal = await ledgerService.spendPoints({
        userId,
        amount: 100,
        idempotencyKey: redemptionKey,
      });

      // Reverse spend (refund voucher)
      await ledgerService.reverseJournal({
        targetJournalId: spendJournal.id,
        reason: 'Voucher refund reversal',
        idempotencyKey: `reversal:redemption:${randomUUID()}`,
      });

      const result = await refundService.submitRefund(
        topUp.id,
        {
          reason: 'WRONG_AMOUNT',
          note: 'wrong amount',
        },
        { userId },
      );

      expect(result.request.eligibility).toBe('NOT_ELIGIBLE');
      expect(result.request.ineligibleReason).toBe('SPENT_SINCE_TOP_UP');
    });

    it('does not treat an escrow close-refund as spend', async () => {
      // 1. Setup a survey with escrow before the top-up
      const formId = randomUUID();
      const formVersionId = randomUUID();
      currentTime = new Date('2026-10-16T10:00:00.000Z');
      await ledgerService.creditPayosTopUp({
        topUpId: randomUUID(),
        userId,
        points: 500,
        orderCode: 999003,
      });
      await ledgerService.reserveEscrow({
        formVersionId,
        userId,
        amount: 500,
        formTitle: 'Old survey',
      });

      // 2. Now do the top-up that will be refunded (at 11:00)
      currentTime = new Date('2026-10-16T11:00:00.000Z');
      const topUp = await createSuccessfulTopUp({
        points: 200,
        paidAt: currentTime,
      });

      // 3. Close the old survey, returning unused escrow (at 12:00)
      currentTime = new Date('2026-10-16T12:00:00.000Z');
      await ledgerService.refundUnusedEscrow({
        userId,
        formId,
        closeVersion: 1,
        unusedAmount: 300,
        formTitle: 'Old survey',
      });

      const result = await refundService.submitRefund(
        topUp.id,
        {
          reason: 'WRONG_AMOUNT',
          note: 'wrong amount',
        },
        { userId },
      );

      expect(result.request.eligibility).toBe('ELIGIBLE');
      expect(result.request.ineligibleReason).toBeNull();
    });

    it('refuses legacy MANUAL top-ups with 409 LEGACY_MANUAL', async () => {
      const topUp = await createSuccessfulTopUp({ channel: 'MANUAL' });

      await expect(
        refundService.submitRefund(
          topUp.id,
          { reason: 'WRONG_AMOUNT', note: 'test' },
          { userId },
        ),
      ).rejects.toMatchObject({
        code: 'TOPUP_REFUND_NOT_ALLOWED',
        reason: 'LEGACY_MANUAL',
      });
      expect(repository.refundRequests.size).toBe(0);
    });

    it('refuses non-SUCCESSFUL top-ups with 409 NOT_SUCCESSFUL', async () => {
      const topUp = await createSuccessfulTopUp({ status: 'PROCESSING' });

      await expect(
        refundService.submitRefund(
          topUp.id,
          { reason: 'WRONG_AMOUNT', note: 'test' },
          { userId },
        ),
      ).rejects.toMatchObject({
        code: 'TOPUP_REFUND_NOT_ALLOWED',
        reason: 'NOT_SUCCESSFUL',
      });
      expect(repository.refundRequests.size).toBe(0);
    });

    it('refuses mismatch-credited top-ups with 409 MISMATCH_CREDITED', async () => {
      const topUp = await createSuccessfulTopUp({ isMismatchCredit: true });

      await expect(
        refundService.submitRefund(
          topUp.id,
          { reason: 'WRONG_AMOUNT', note: 'test' },
          { userId },
        ),
      ).rejects.toMatchObject({
        code: 'TOPUP_REFUND_NOT_ALLOWED',
        reason: 'MISMATCH_CREDITED',
      });
      expect(repository.refundRequests.size).toBe(0);
    });

    it('enforces deadline boundary strictly (paidAt + 24h - 1ms allowed, exact rejected)', async () => {
      const paidAt = new Date('2026-10-15T12:00:00.000Z');
      const topUp = await createSuccessfulTopUp({ paidAt });

      // 1. Exactly 24h: 2026-10-16T12:00:00.000Z -> DEADLINE_PASSED
      currentTime = new Date('2026-10-16T12:00:00.000Z');
      await expect(
        refundService.submitRefund(
          topUp.id,
          { reason: 'WRONG_AMOUNT', note: 'test' },
          { userId },
        ),
      ).rejects.toMatchObject({
        code: 'TOPUP_REFUND_NOT_ALLOWED',
        reason: 'DEADLINE_PASSED',
      });

      // 2. 24h - 1ms: 2026-10-16T11:59:59.999Z -> accepted
      currentTime = new Date('2026-10-16T11:59:59.999Z');
      const result = await refundService.submitRefund(
        topUp.id,
        { reason: 'WRONG_AMOUNT', note: 'test' },
        { userId },
      );
      expect(result.request.status).toBe('REQUESTED');
    });

    it('refuses second request for same top-up with 409 TOPUP_REFUND_ALREADY_REQUESTED', async () => {
      const topUp = await createSuccessfulTopUp();
      await refundService.submitRefund(
        topUp.id,
        { reason: 'WRONG_AMOUNT', note: 'test' },
        { userId },
      );

      await expect(
        refundService.submitRefund(
          topUp.id,
          { reason: 'WRONG_AMOUNT', note: 'second try' },
          { userId },
        ),
      ).rejects.toThrow(TopUpRefundAlreadyRequestedException);
    });

    it('refuses refund submission on another user top-up with 404', async () => {
      const topUp = await createSuccessfulTopUp({ targetUserId: otherUserId });

      await expect(
        refundService.submitRefund(
          topUp.id,
          { reason: 'WRONG_AMOUNT', note: 'test' },
          { userId },
        ),
      ).rejects.toThrow(TopUpRequestNotFoundException);
    });
  });

  describe('withdrawRefund', () => {
    it('withdraws ELIGIBLE refund request and releases hold back to Available', async () => {
      const topUp = await createSuccessfulTopUp({ points: 300 });
      await refundService.submitRefund(
        topUp.id,
        { reason: 'WRONG_AMOUNT', note: 'test' },
        { userId },
      );

      const walletHeld = await ledgerService.getWallet(userId);
      expect(walletHeld.balance.available).toBe(0);
      expect(walletHeld.balance.refundHold).toBe(300);

      const result = await refundService.withdrawRefund(topUp.id, { userId });
      expect(result.replayed).toBe(false);
      expect(result.request.status).toBe('WITHDRAWN');
      expect(result.request.withdrawnAt).not.toBeNull();

      // Balance released back to Available
      const walletAfter = await ledgerService.getWallet(userId);
      expect(walletAfter.balance.available).toBe(300);
      expect(walletAfter.balance.refundHold).toBe(0);

      // Outbox withdrawal events
      const withdrawnUserEvent = repository.refundEvents.find(
        (e) =>
          e.eventType === TOP_UP_REFUND_CHANGED_EVENT_TYPE &&
          (e.payload as any).status === 'WITHDRAWN',
      );
      expect(withdrawnUserEvent).toBeDefined();
    });

    it('withdraws NOT_ELIGIBLE refund request without posting release journal', async () => {
      const topUp = await createSuccessfulTopUp({ points: 300 });
      // Spend points to make it NOT_ELIGIBLE
      await ledgerService.spendPoints({
        userId,
        amount: 100,
        idempotencyKey: `redemption:${userId}:${randomUUID()}`,
      });
      await refundService.submitRefund(
        topUp.id,
        { reason: 'WRONG_AMOUNT', note: 'test' },
        { userId },
      );

      const result = await refundService.withdrawRefund(topUp.id, { userId });
      expect(result.replayed).toBe(false);
      expect(result.request.status).toBe('WITHDRAWN');

      const wallet = await ledgerService.getWallet(userId);
      expect(wallet.balance.available).toBe(200);
      expect(wallet.balance.refundHold).toBe(0);
    });

    it('replays 200 replayed=true when withdrawing an already-WITHDRAWN request', async () => {
      const topUp = await createSuccessfulTopUp({ points: 200 });
      await refundService.submitRefund(
        topUp.id,
        { reason: 'WRONG_AMOUNT', note: 'test' },
        { userId },
      );
      await refundService.withdrawRefund(topUp.id, { userId });

      const replayResult = await refundService.withdrawRefund(topUp.id, {
        userId,
      });
      expect(replayResult.replayed).toBe(true);
      expect(replayResult.request.status).toBe('WITHDRAWN');
    });

    it('refuses resubmission after withdrawal with 409 TOPUP_REFUND_ALREADY_REQUESTED', async () => {
      const topUp = await createSuccessfulTopUp({ points: 200 });
      await refundService.submitRefund(
        topUp.id,
        { reason: 'WRONG_AMOUNT', note: 'test' },
        { userId },
      );
      await refundService.withdrawRefund(topUp.id, { userId });

      await expect(
        refundService.submitRefund(
          topUp.id,
          { reason: 'WRONG_AMOUNT', note: 'resubmit' },
          { userId },
        ),
      ).rejects.toThrow(TopUpRefundAlreadyRequestedException);
    });

    it('refuses withdrawal on REFUNDED or REJECTED request with 409 REFUND_ALREADY_RESOLVED', async () => {
      const topUp = await createSuccessfulTopUp({ points: 200 });
      await refundService.submitRefund(
        topUp.id,
        { reason: 'WRONG_AMOUNT', note: 'test' },
        { userId },
      );

      // Simulate admin resolved to REFUNDED
      const req = repository.refundRequestsByTopUp.get(topUp.id)!;
      req.status = 'REFUNDED';

      await expect(
        refundService.withdrawRefund(topUp.id, { userId }),
      ).rejects.toThrow(RefundAlreadyResolvedException);
    });
  });

  describe('DTO & Read API', () => {
    it('populates refund info on getOwned and listOwned with correct precedence', async () => {
      const topUp = await createSuccessfulTopUp({ points: 200 });

      // Before refund request: canRequest = true
      const dtoBefore = await payosService.getOwned(userId, topUp.id);
      expect(dtoBefore.refundDeadline).not.toBeNull();
      expect(dtoBefore.refund).toEqual({
        canRequest: true,
        unavailableReason: null,
        request: null,
        destination: {
          bankId: '970422',
          bankName: 'MB Bank',
          holderName: 'NGUYEN VAN A',
          last4: '6789',
          accountNumber: '0123456789',
          verified: true,
        },
      });

      // Submit refund
      await refundService.submitRefund(
        topUp.id,
        { reason: 'WRONG_AMOUNT', note: 'test' },
        { userId },
      );

      const dtoRequested = await payosService.getOwned(userId, topUp.id);
      expect(dtoRequested.refund.canRequest).toBe(false);
      expect(dtoRequested.refund.unavailableReason).toBe('ALREADY_REQUESTED');
      expect(dtoRequested.refund.request).toMatchObject({
        status: 'REQUESTED',
        destination: { last4: '6789' },
      });

      // Withdraw refund
      await refundService.withdrawRefund(topUp.id, { userId });
      const dtoWithdrawn = await payosService.getOwned(userId, topUp.id);
      expect(dtoWithdrawn.refund.canRequest).toBe(false);
      expect(dtoWithdrawn.refund.unavailableReason).toBe('WITHDRAWN');
      expect(dtoWithdrawn.refund.request?.status).toBe('WITHDRAWN');
    });

    it('reports MISMATCH_CREDITED precedence over DEADLINE_PASSED', async () => {
      const paidAt = new Date('2026-10-10T12:00:00Z'); // Long ago
      const topUp = await createSuccessfulTopUp({
        paidAt,
        isMismatchCredit: true,
      });

      const dto = await payosService.getOwned(userId, topUp.id);
      expect(dto.refund.canRequest).toBe(false);
      expect(dto.refund.unavailableReason).toBe('MISMATCH_CREDITED');
    });
  });

  describe('Outbox Handlers', () => {
    it('delivers user notifications for REQUESTED (eligible / ineligible) and WITHDRAWN', async () => {
      const publisher = { publish: jest.fn().mockResolvedValue(undefined) };
      const handler = new TopUpRefundNotificationHandler(publisher as any);

      // 1. REQUESTED + ELIGIBLE
      await handler.handle({
        id: randomUUID(),
        idempotencyKey: 'key_1',
        eventType: TOP_UP_REFUND_CHANGED_EVENT_TYPE,
        schemaVersion: 1,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        payload: {
          schemaVersion: 1,
          requestId: randomUUID(),
          topUpId: randomUUID(),
          userId,
          orderCode: 123456,
          status: 'REQUESTED',
          eligibility: 'ELIGIBLE',
          ineligibleReason: null,
          points: 50,
          amountVnd: 10_000,
          occurredAt: currentTime.toISOString(),
        },
      } as any);

      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'TOPUP_REFUND_REQUESTED',
          message: expect.stringContaining(
            '50 Điểm đang được giữ chờ hoàn tiền',
          ),
        }),
      );

      // 2. REQUESTED + NOT_ELIGIBLE
      await handler.handle({
        id: randomUUID(),
        idempotencyKey: 'key_2',
        eventType: TOP_UP_REFUND_CHANGED_EVENT_TYPE,
        schemaVersion: 1,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        payload: {
          schemaVersion: 1,
          requestId: randomUUID(),
          topUpId: randomUUID(),
          userId,
          orderCode: 123456,
          status: 'REQUESTED',
          eligibility: 'NOT_ELIGIBLE',
          ineligibleReason: 'SPENT_SINCE_TOP_UP',
          points: 50,
          amountVnd: 10_000,
          occurredAt: currentTime.toISOString(),
        },
      } as any);

      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'TOPUP_REFUND_REQUESTED',
          message: expect.stringContaining(
            'nhưng yêu cầu không đủ điều kiện vì Điểm đã được sử dụng',
          ),
        }),
      );

      // 3. WITHDRAWN
      await handler.handle({
        id: randomUUID(),
        idempotencyKey: 'key_3',
        eventType: TOP_UP_REFUND_CHANGED_EVENT_TYPE,
        schemaVersion: 1,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: randomUUID(),
        aggregateVersion: 2,
        payload: {
          schemaVersion: 1,
          requestId: randomUUID(),
          topUpId: randomUUID(),
          userId,
          orderCode: 123456,
          status: 'WITHDRAWN',
          eligibility: 'ELIGIBLE',
          ineligibleReason: null,
          points: 50,
          amountVnd: 10_000,
          occurredAt: currentTime.toISOString(),
        },
      } as any);

      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'TOPUP_REFUND_WITHDRAWN',
          message: expect.stringContaining('50 Điểm đã trở lại Khả dụng.'),
        }),
      );
    });

    it('sends admin in-app notification and email to refund mailbox with last4 only', async () => {
      const notifications = { publish: jest.fn().mockResolvedValue(undefined) };
      const emailSender = {
        send: jest.fn().mockResolvedValue({ outcome: 'DELIVERED' }),
      };
      const adminCapability = { listActiveAdminIds: async () => [adminId] };
      const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

      const handler = new TopUpRefundAdminNoticeHandler(
        adminCapability as any,
        notifications as any,
        emailSender as any,
        () => 'refunds@rescom.vn',
        'http://localhost:3000',
        logger as any,
      );

      await handler.handle({
        id: randomUUID(),
        idempotencyKey: 'admin_key_1',
        eventType: TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE,
        schemaVersion: 1,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        payload: {
          schemaVersion: 1,
          requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          topUpId: randomUUID(),
          userId,
          orderCode: 123456,
          status: 'REQUESTED',
          eligibility: 'ELIGIBLE',
          ineligibleReason: null,
          points: 100,
          amountVnd: 20_000,
          occurredAt: currentTime.toISOString(),
          userEmail: 'user@example.com',
          reason: 'WRONG_AMOUNT',
          note: 'Refund please',
          destination: {
            bankId: '970422',
            bankName: 'MB Bank',
            holderName: 'NGUYEN VAN A',
            last4: '4321',
            verified: true,
          },
        },
      } as any);

      // Leg 1: In-app to admin
      expect(notifications.publish).toHaveBeenCalledWith({
        userId: adminId,
        type: 'WARNING',
        message: expect.stringContaining('#123456'),
        dedupeKey: 'admin_key_1',
      });

      // Leg 2: Email to mailbox
      expect(emailSender.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'refunds@rescom.vn',
          subject: 'Rescom: Yêu cầu hoàn tiền #123456',
          text: expect.stringContaining('•••• 4321'),
          html: expect.stringContaining('tab=refunds'),
        }),
      );
    });

    it('HTML-escapes user-controlled fields and renders Vietnamese labels', async () => {
      const emailSender = {
        send: jest.fn().mockResolvedValue({ outcome: 'DELIVERED' }),
      };
      const handler = new TopUpRefundAdminNoticeHandler(
        { listActiveAdminIds: async () => [] } as any,
        { publish: jest.fn() } as any,
        emailSender as any,
        () => 'refunds@rescom.vn',
        'http://localhost:3000',
        { warn: jest.fn(), log: jest.fn(), error: jest.fn() } as any,
      );
      await handler.handle({
        id: randomUUID(),
        idempotencyKey: 'admin_key_esc',
        eventType: TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE,
        schemaVersion: 1,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        payload: {
          schemaVersion: 1,
          requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          topUpId: randomUUID(),
          userId,
          orderCode: 123456,
          status: 'REQUESTED',
          eligibility: 'NOT_ELIGIBLE',
          ineligibleReason: 'SPENT_SINCE_TOP_UP',
          points: 100,
          amountVnd: 20_000,
          occurredAt: currentTime.toISOString(),
          userEmail: 'user@example.com',
          reason: 'WRONG_ACCOUNT',
          note: '<a href="x">click</a>',
          destination: {
            bankId: '970422',
            bankName: 'MB Bank',
            holderName: '<b>HOLDER</b>',
            last4: '4321',
            verified: true,
          },
        },
      } as any);
      const arg = emailSender.send.mock.calls[0][0];
      expect(arg.html).toContain('&lt;a href=&quot;x&quot;&gt;');
      expect(arg.html).not.toContain('<a href="x">');
      expect(arg.html).not.toContain('<b>HOLDER</b>');
      expect(arg.html).toContain('Nạp nhầm tài khoản Rescom');
      expect(arg.html).toContain('Đã dùng Điểm sau khi nạp');
      expect(arg.text).toContain('Nạp nhầm tài khoản Rescom');
    });

    it('skips email leg when refund mailbox is not configured', async () => {
      const notifications = { publish: jest.fn().mockResolvedValue(undefined) };
      const emailSender = { send: jest.fn() };
      const adminCapability = { listActiveAdminIds: async () => [adminId] };
      const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

      const handler = new TopUpRefundAdminNoticeHandler(
        adminCapability as any,
        notifications as any,
        emailSender as any,
        () => null, // null mailbox
        'http://localhost:3000',
        logger as any,
      );

      await handler.handle({
        id: randomUUID(),
        idempotencyKey: 'admin_key_2',
        eventType: TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE,
        schemaVersion: 1,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        payload: {
          schemaVersion: 1,
          requestId: randomUUID(),
          topUpId: randomUUID(),
          userId,
          orderCode: 123456,
          status: 'WITHDRAWN',
          eligibility: 'ELIGIBLE',
          ineligibleReason: null,
          points: 100,
          amountVnd: 20_000,
          occurredAt: currentTime.toISOString(),
          userEmail: 'user@example.com',
          reason: 'WRONG_AMOUNT',
          note: 'Refund please',
          destination: {
            bankId: '970422',
            bankName: 'MB Bank',
            holderName: 'NGUYEN VAN A',
            last4: '4321',
            verified: true,
          },
        },
      } as any);

      expect(emailSender.send).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('refund mailbox is not configured'),
      );
    });
  });
});
