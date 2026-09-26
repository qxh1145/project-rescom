import {
  TOP_UP_MAX_PENDING_REQUESTS,
  buildVietQrPayload,
  topUpAdminAuditEventPayloadSchema,
  topUpRequestSchema,
  topUpReviewResultSchema,
} from '@rescom/schemas';
import {
  PassThroughUnitOfWork,
  UnitOfWorkPort,
} from '../../../common/database/unit-of-work.port';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { InMemoryTopUpRepository } from '../infrastructure/in-memory-top-up.repository';
import { InMemoryAdminCapabilityRepository } from '../infrastructure/in-memory-admin-capability.repository';
import { LedgerService } from './ledger.service';
import { TopUpPaymentConfig, TopUpService } from './top-up.service';
import {
  InvalidTopUpRequestException,
  TopUpAdminCapabilityRequiredException,
  TopUpAlreadyReviewedException,
  TopUpPendingLimitExceededException,
  TopUpReferenceConflictException,
  TopUpRequestNotFoundException,
  TopUpSelfReviewForbiddenException,
} from './exceptions/economy.exceptions';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';

/** Records whether each call happened inside the Unit of Work callback. */
class RecordingUnitOfWork implements UnitOfWorkPort {
  readonly keys: string[] = [];
  active = false;

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    this.keys.push(key);
    this.active = true;
    try {
      return await work();
    } finally {
      this.active = false;
    }
  }
}

describe('Story 6.6: TopUpService (FR-34, FR-35, AD-16)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const secondAdminId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const correlationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  const paymentConfig: TopUpPaymentConfig = {
    bankName: 'Vietcombank',
    bankBin: '970436',
    accountNumber: '0123456789',
    accountName: 'RESCOM DEMO',
  };

  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let topUpRepo: InMemoryTopUpRepository;
  let users: Map<string, { id: string; role: string; status: string }>;
  let unitOfWork: RecordingUnitOfWork;
  let publisher: jest.Mocked<NotificationPublisherPort>;
  let service: TopUpService;
  let referenceCounter: number;

  function buildService(
    overrides: Partial<{ unitOfWork: UnitOfWorkPort }> = {},
  ) {
    return new TopUpService({
      repository: topUpRepo,
      ledgerService,
      adminCapability: new InMemoryAdminCapabilityRepository(
        async (id) => users.get(id) ?? null,
      ),
      paymentConfig: () => paymentConfig,
      unitOfWork: overrides.unitOfWork ?? unitOfWork,
      notificationPublisher: publisher,
      generateReference: () => {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        referenceCounter += 1;
        let remaining = referenceCounter;
        let code = '';
        for (let i = 0; i < 8; i += 1) {
          code = alphabet[remaining % 32] + code;
          remaining = Math.floor(remaining / 32);
        }
        return `RESCOM${code}`;
      },
    });
  }

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository();
    ledgerService = new LedgerService(ledgerRepo);
    topUpRepo = new InMemoryTopUpRepository();
    topUpRepo.setUserEmail(userId, 'student@fpt.edu.vn');
    users = new Map([
      [userId, { id: userId, role: 'RESPONDENT', status: 'ACTIVE' }],
      [otherUserId, { id: otherUserId, role: 'RESPONDENT', status: 'ACTIVE' }],
      [adminId, { id: adminId, role: 'ADMIN', status: 'ACTIVE' }],
      [secondAdminId, { id: secondAdminId, role: 'ADMIN', status: 'ACTIVE' }],
    ]);
    unitOfWork = new RecordingUnitOfWork();
    publisher = { publish: jest.fn().mockResolvedValue('CREATED') };
    referenceCounter = 0;
    service = buildService();
  });

  async function availableBalance(ownerId: string): Promise<number> {
    const wallet = await ledgerService.getWallet(ownerId);
    return wallet.balance.available;
  }

  describe('createRequest (FR-34)', () => {
    it('creates a Pending Payment request with bank info, transfer syntax and VietQR payload', async () => {
      const dto = await service.createRequest(userId, { amount: 150 });

      expect(topUpRequestSchema.safeParse(dto).success).toBe(true);
      expect(dto.status).toBe('PENDING');
      expect(dto.amount).toBe(150);
      expect(dto.amountVnd).toBe(30_000);
      expect(dto.transferReference).toMatch(/^RESCOM[A-HJ-NP-Z2-9]{8}$/);
      expect(dto.reviewedAt).toBeNull();
      expect(dto.paymentInstructions).toEqual({
        ...paymentConfig,
        amountVnd: 30_000,
        transferContent: dto.transferReference,
        qrPayload: buildVietQrPayload({
          bankBin: paymentConfig.bankBin,
          accountNumber: paymentConfig.accountNumber,
          amountVnd: 30_000,
          transferContent: dto.transferReference,
        }),
      });
    });

    it('does not move any Points before approval (one-way, admin-verified)', async () => {
      const dto = await service.createRequest(userId, { amount: 100 });
      expect(await availableBalance(userId)).toBe(0);
      expect(
        await ledgerService.findJournalByIdempotencyKey(
          `topup-approval:${dto.id}`,
        ),
      ).toBeNull();
    });

    it('rejects amounts outside the allowed range', async () => {
      await expect(
        service.createRequest(userId, { amount: 99 }),
      ).rejects.toBeInstanceOf(InvalidTopUpRequestException);
      await expect(
        service.createRequest(userId, { amount: 50_001 }),
      ).rejects.toBeInstanceOf(InvalidTopUpRequestException);
      await expect(
        service.createRequest(userId, { amount: 100, status: 'APPROVED' }),
      ).rejects.toBeInstanceOf(InvalidTopUpRequestException);
    });

    it(`limits a user to ${TOP_UP_MAX_PENDING_REQUESTS} open requests`, async () => {
      for (let i = 0; i < TOP_UP_MAX_PENDING_REQUESTS; i += 1) {
        await service.createRequest(userId, { amount: 100 });
      }
      await expect(
        service.createRequest(userId, { amount: 100 }),
      ).rejects.toBeInstanceOf(TopUpPendingLimitExceededException);

      // Other users are unaffected.
      await expect(
        service.createRequest(otherUserId, { amount: 100 }),
      ).resolves.toMatchObject({ status: 'PENDING' });
    });

    it('retries a transfer-reference collision with a fresh reference', async () => {
      const references = ['RESCOMAAAAAAAA', 'RESCOMAAAAAAAA', 'RESCOMBBBBBBBB'];
      const collidingService = new TopUpService({
        repository: topUpRepo,
        ledgerService,
        adminCapability: new InMemoryAdminCapabilityRepository(
          async (id) => users.get(id) ?? null,
        ),
        paymentConfig: () => paymentConfig,
        generateReference: () => references.shift() ?? 'RESCOMCCCCCCCC',
      });

      const first = await collidingService.createRequest(userId, {
        amount: 100,
      });
      const second = await collidingService.createRequest(otherUserId, {
        amount: 100,
      });
      expect(first.transferReference).toBe('RESCOMAAAAAAAA');
      expect(second.transferReference).toBe('RESCOMBBBBBBBB');
    });

    it('gives up after repeated reference collisions', async () => {
      const stuckService = new TopUpService({
        repository: topUpRepo,
        ledgerService,
        adminCapability: new InMemoryAdminCapabilityRepository(
          async (id) => users.get(id) ?? null,
        ),
        paymentConfig: () => paymentConfig,
        generateReference: () => 'RESCOMAAAAAAAA',
      });
      await stuckService.createRequest(userId, { amount: 100 });
      await expect(
        stuckService.createRequest(otherUserId, { amount: 100 }),
      ).rejects.toBeInstanceOf(TopUpReferenceConflictException);
    });
  });

  describe('listing', () => {
    it("lists only the caller's requests, newest first", async () => {
      const older = await service.createRequest(userId, { amount: 100 });
      await service.createRequest(otherUserId, { amount: 200 });
      const newer = await service.createRequest(userId, { amount: 300 });

      const list = await service.listMyRequests(userId, {});
      expect(list.total).toBe(2);
      expect(list.items.map((item) => item.id)).toEqual([newer.id, older.id]);
      expect(list.hasMore).toBe(false);
      expect(list.limit).toBe(20);
    });

    it('lists the pending Admin queue oldest first with owner email', async () => {
      const first = await service.createRequest(userId, { amount: 100 });
      const second = await service.createRequest(otherUserId, { amount: 200 });

      const queue = await service.listForReview({});
      expect(queue.items.map((item) => item.id)).toEqual([first.id, second.id]);
      expect(queue.items[0].userEmail).toBe('student@fpt.edu.vn');
      expect(queue.items[1].userEmail).toBeNull();
      expect(queue.items[0].userId).toBe(userId);
    });

    it('rejects malformed list queries', async () => {
      await expect(
        service.listMyRequests(userId, { limit: 0 }),
      ).rejects.toBeInstanceOf(InvalidTopUpRequestException);
      await expect(
        service.listForReview({ status: 'DONE' }),
      ).rejects.toBeInstanceOf(InvalidTopUpRequestException);
    });
  });

  describe('approveTopUp (ApproveTopUp coordinator, AD-16)', () => {
    it('credits Available once, records actor/correlation and emits the admin-audit Outbox event', async () => {
      const request = await service.createRequest(userId, { amount: 250 });

      const result = await service.approveTopUp({
        topUpId: request.id,
        adminId,
        correlationId,
      });

      expect(topUpReviewResultSchema.safeParse(result).success).toBe(true);
      expect(result.replayed).toBe(false);
      expect(result.topUp.status).toBe('APPROVED');
      expect(result.topUp.adminId).toBe(adminId);
      expect(result.topUp.correlationId).toBe(correlationId);
      expect(result.topUp.reviewedAt).not.toBeNull();
      expect(result.topUp.paymentInstructions).toBeNull();
      expect(result.topUp.userEmail).toBe('student@fpt.edu.vn');

      const journal = await ledgerService.findJournalByIdempotencyKey(
        `topup-approval:${request.id}`,
      );
      expect(journal).not.toBeNull();
      expect(result.journalId).toBe(journal!.id);
      expect(result.topUp.journalId).toBe(journal!.id);
      expect(await availableBalance(userId)).toBe(250);

      expect(unitOfWork.keys).toEqual([`topup-approval:${request.id}`]);

      expect(topUpRepo.outboxEvents).toHaveLength(1);
      const event = topUpRepo.outboxEvents[0];
      expect(event).toMatchObject({
        idempotencyKey: `admin-audit:topup-approval:${request.id}`,
        eventType: 'AdminTopUpApproved',
        producer: 'economy-service',
        aggregateType: 'TopUpRequest',
        aggregateId: request.id,
        aggregateVersion: 2,
        correlationId,
      });
      expect(
        topUpAdminAuditEventPayloadSchema.parse(event.payload),
      ).toMatchObject({
        action: 'TOPUP_APPROVED',
        auditCategory: 'MODERATION_ADMIN_ACTION',
        topUpId: request.id,
        userId,
        adminId,
        amount: 250,
        amountVnd: 50_000,
        journalId: journal!.id,
        ledgerIdempotencyKey: `topup-approval:${request.id}`,
        correlationId,
      });

      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'TOPUP_SUCCESS',
          dedupeKey: `topup-approval:${request.id}`,
        }),
      );
    });

    it('posts the journal and writes the decision + audit event inside the Unit of Work', async () => {
      const request = await service.createRequest(userId, { amount: 100 });
      const observations: Array<[string, boolean]> = [];
      const postSpy = jest.spyOn(ledgerRepo, 'postJournalTransaction');
      postSpy.mockImplementation(async (...args) => {
        observations.push(['journal', unitOfWork.active]);
        postSpy.mockRestore();
        return ledgerRepo.postJournalTransaction(...args);
      });
      const saveSpy = jest.spyOn(topUpRepo, 'saveReviewDecision');
      saveSpy.mockImplementation(async (...args) => {
        observations.push(['decision', unitOfWork.active]);
        saveSpy.mockRestore();
        return topUpRepo.saveReviewDecision(...args);
      });
      const lockSpy = jest.spyOn(topUpRepo, 'findByIdForUpdate');

      await service.approveTopUp({ topUpId: request.id, adminId });

      expect(observations).toEqual([
        ['journal', true],
        ['decision', true],
      ]);
      expect(lockSpy).toHaveBeenCalledWith(request.id);
      // Notification only after the Unit of Work finished.
      expect(publisher.publish).toHaveBeenCalledTimes(1);
    });

    it('returns the original result on retry without a second credit or audit event', async () => {
      const request = await service.createRequest(userId, { amount: 100 });
      const first = await service.approveTopUp({
        topUpId: request.id,
        adminId,
        correlationId,
      });
      const retry = await service.approveTopUp({
        topUpId: request.id,
        adminId: secondAdminId,
      });

      expect(retry.replayed).toBe(true);
      expect(retry.journalId).toBe(first.journalId);
      expect(retry.topUp.adminId).toBe(adminId);
      expect(retry.topUp.correlationId).toBe(correlationId);
      expect(await availableBalance(userId)).toBe(100);
      expect(topUpRepo.outboxEvents).toHaveLength(1);
      // Replays re-publish with the same dedupe key (the port deduplicates).
      expect(publisher.publish).toHaveBeenCalledTimes(2);
      expect(publisher.publish.mock.calls[1][0].dedupeKey).toBe(
        `topup-approval:${request.id}`,
      );
    });

    it('never credits twice under concurrent double approval', async () => {
      const request = await service.createRequest(userId, { amount: 300 });
      const results = await Promise.all([
        service.approveTopUp({ topUpId: request.id, adminId }),
        service.approveTopUp({ topUpId: request.id, adminId: secondAdminId }),
      ]);

      expect(results.filter((result) => !result.replayed)).toHaveLength(1);
      expect(new Set(results.map((result) => result.journalId)).size).toBe(1);
      expect(await availableBalance(userId)).toBe(300);
      expect(topUpRepo.outboxEvents).toHaveLength(1);
      expect((await ledgerService.verifyLedgerIntegrity()).isZeroSum).toBe(
        true,
      );
    });

    it.each([
      ['a demoted admin', { role: 'PUBLISHER', status: 'ACTIVE' }],
      ['a locked admin', { role: 'ADMIN', status: 'LOCKED' }],
    ])(
      're-checks the live capability and refuses %s',
      async (_label, capability) => {
        const request = await service.createRequest(userId, { amount: 100 });
        users.set(adminId, { id: adminId, ...capability });

        await expect(
          service.approveTopUp({ topUpId: request.id, adminId }),
        ).rejects.toBeInstanceOf(TopUpAdminCapabilityRequiredException);

        expect((await topUpRepo.findById(request.id))!.status).toBe('PENDING');
        expect(await availableBalance(userId)).toBe(0);
        expect(topUpRepo.outboxEvents).toHaveLength(0);
        expect(publisher.publish).not.toHaveBeenCalled();
      },
    );

    it('refuses an actor that no longer exists', async () => {
      const request = await service.createRequest(userId, { amount: 100 });
      users.delete(adminId);
      await expect(
        service.approveTopUp({ topUpId: request.id, adminId }),
      ).rejects.toBeInstanceOf(TopUpAdminCapabilityRequiredException);
    });

    it('forbids an admin from approving their own request', async () => {
      const request = await service.createRequest(adminId, { amount: 100 });
      await expect(
        service.approveTopUp({ topUpId: request.id, adminId }),
      ).rejects.toBeInstanceOf(TopUpSelfReviewForbiddenException);
      expect(await availableBalance(adminId)).toBe(0);
    });

    it('returns 404-style error for unknown requests', async () => {
      await expect(
        service.approveTopUp({
          topUpId: '99999999-9999-4999-8999-999999999999',
          adminId,
        }),
      ).rejects.toBeInstanceOf(TopUpRequestNotFoundException);
    });

    it('refuses to approve a rejected request', async () => {
      const request = await service.createRequest(userId, { amount: 100 });
      await service.rejectTopUp({
        topUpId: request.id,
        adminId,
        reason: 'Không tìm thấy giao dịch',
      });

      await expect(
        service.approveTopUp({ topUpId: request.id, adminId }),
      ).rejects.toBeInstanceOf(TopUpAlreadyReviewedException);
      expect(await availableBalance(userId)).toBe(0);
    });

    it('leaves the request PENDING when the ledger journal fails', async () => {
      const request = await service.createRequest(userId, { amount: 100 });
      jest
        .spyOn(ledgerService, 'creditApprovedTopUp')
        .mockRejectedValueOnce(new Error('ledger unavailable'));

      await expect(
        service.approveTopUp({ topUpId: request.id, adminId }),
      ).rejects.toThrow('ledger unavailable');

      expect((await topUpRepo.findById(request.id))!.status).toBe('PENDING');
      expect(topUpRepo.outboxEvents).toHaveLength(0);
      expect(publisher.publish).not.toHaveBeenCalled();

      // A later retry succeeds normally.
      const retry = await service.approveTopUp({
        topUpId: request.id,
        adminId,
      });
      expect(retry.replayed).toBe(false);
      expect(await availableBalance(userId)).toBe(100);
    });

    it('generates a correlation id when the supplied one is not a UUID', async () => {
      const request = await service.createRequest(userId, { amount: 100 });
      const result = await service.approveTopUp({
        topUpId: request.id,
        adminId,
        correlationId: 'not-a-uuid',
      });
      expect(result.topUp.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(result.topUp.correlationId).not.toBe('not-a-uuid');
    });

    it('works with the default pass-through Unit of Work', async () => {
      const passThrough = new PassThroughUnitOfWork();
      const plainService = buildService({ unitOfWork: passThrough });
      const request = await plainService.createRequest(userId, { amount: 100 });
      await plainService.approveTopUp({ topUpId: request.id, adminId });
      expect(passThrough.keys).toEqual([`topup-approval:${request.id}`]);
    });
  });

  describe('rejectTopUp (FR-35)', () => {
    it('rejects with a reason, posts no journal, emits the audit event and warns the user', async () => {
      const request = await service.createRequest(userId, { amount: 100 });

      const result = await service.rejectTopUp({
        topUpId: request.id,
        adminId,
        reason: '  Không tìm thấy giao dịch chuyển khoản  ',
        correlationId,
      });

      expect(result.replayed).toBe(false);
      expect(result.journalId).toBeNull();
      expect(result.topUp.status).toBe('REJECTED');
      expect(result.topUp.rejectionReason).toBe(
        'Không tìm thấy giao dịch chuyển khoản',
      );
      expect(result.topUp.paymentInstructions).toBeNull();
      expect(unitOfWork.keys).toEqual([`topup-rejection:${request.id}`]);
      expect(await availableBalance(userId)).toBe(0);
      expect(
        await ledgerService.findJournalByIdempotencyKey(
          `topup-approval:${request.id}`,
        ),
      ).toBeNull();

      expect(topUpRepo.outboxEvents).toHaveLength(1);
      expect(topUpRepo.outboxEvents[0]).toMatchObject({
        idempotencyKey: `admin-audit:topup-rejection:${request.id}`,
        eventType: 'AdminTopUpRejected',
        correlationId,
      });
      expect(topUpRepo.outboxEvents[0].payload).toMatchObject({
        action: 'TOPUP_REJECTED',
        journalId: null,
        ledgerIdempotencyKey: null,
        rejectionReason: 'Không tìm thấy giao dịch chuyển khoản',
      });

      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'WARNING',
          dedupeKey: `topup-rejection:${request.id}`,
          message: expect.stringContaining(
            'Không tìm thấy giao dịch chuyển khoản',
          ),
        }),
      );
    });

    it('keeps the rejection notification within the 500-character limit', async () => {
      const request = await service.createRequest(userId, { amount: 100 });
      await service.rejectTopUp({
        topUpId: request.id,
        adminId,
        reason: 'x'.repeat(500),
      });
      const message = publisher.publish.mock.calls[0][0].message;
      expect(message.length).toBeLessThanOrEqual(500);
    });

    it('never splits an emoji when shortening the reason (Epic 9 review P9)', async () => {
      const request = await service.createRequest(userId, { amount: 100 });
      await service.rejectTopUp({
        topUpId: request.id,
        adminId,
        reason: `${'r'.repeat(296)}${'😀'.repeat(50)}`,
      });
      const message: string = publisher.publish.mock.calls[0][0].message;
      expect(message).toContain(`Reason: ${'r'.repeat(296)}...`);
      expect(message).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
      );
      expect(message.length).toBeLessThanOrEqual(500);
    });

    it('requires a meaningful reason', async () => {
      const request = await service.createRequest(userId, { amount: 100 });
      await expect(
        service.rejectTopUp({ topUpId: request.id, adminId, reason: ' ok ' }),
      ).rejects.toBeInstanceOf(InvalidTopUpRequestException);
      expect((await topUpRepo.findById(request.id))!.status).toBe('PENDING');
    });

    it('returns the original rejection on retry and refuses to reject an approved request', async () => {
      const rejected = await service.createRequest(userId, { amount: 100 });
      await service.rejectTopUp({
        topUpId: rejected.id,
        adminId,
        reason: 'Sai nội dung chuyển khoản',
      });
      const retry = await service.rejectTopUp({
        topUpId: rejected.id,
        adminId,
        reason: 'Một lý do khác',
      });
      expect(retry.replayed).toBe(true);
      expect(retry.topUp.rejectionReason).toBe('Sai nội dung chuyển khoản');
      expect(topUpRepo.outboxEvents).toHaveLength(1);

      const approved = await service.createRequest(userId, { amount: 100 });
      await service.approveTopUp({ topUpId: approved.id, adminId });
      await expect(
        service.rejectTopUp({
          topUpId: approved.id,
          adminId,
          reason: 'Quá hạn thanh toán',
        }),
      ).rejects.toBeInstanceOf(TopUpAlreadyReviewedException);
      expect(await availableBalance(userId)).toBe(100);
    });

    it('applies the live capability and self-review rules', async () => {
      const request = await service.createRequest(userId, { amount: 100 });
      users.set(adminId, { id: adminId, role: 'RESPONDENT', status: 'ACTIVE' });
      await expect(
        service.rejectTopUp({
          topUpId: request.id,
          adminId,
          reason: 'Không hợp lệ',
        }),
      ).rejects.toBeInstanceOf(TopUpAdminCapabilityRequiredException);

      const own = await service.createRequest(secondAdminId, { amount: 100 });
      await expect(
        service.rejectTopUp({
          topUpId: own.id,
          adminId: secondAdminId,
          reason: 'Không hợp lệ',
        }),
      ).rejects.toBeInstanceOf(TopUpSelfReviewForbiddenException);
    });
  });
});
