import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { LedgerService } from './ledger.service';
import { InMemoryPayosTopUpRepository } from '../infrastructure/in-memory-payos-top-up.repository';
import { AdminTopUpRefundService } from './admin-top-up-refund.service';
import { AdminCapabilityPort } from './ports/admin-capability.port';
import { TopUpRefundRow } from './ports/payos-top-up-repository.port';
import {
  RefundAlreadyResolvedException,
  RefundBankTransferAlreadyRecordedException,
  RefundDestinationUnconfirmedException,
  RefundNotHeldException,
  RefundNotRefundedException,
  RefundResolutionValidationException,
  TopUpAdminCapabilityRequiredException,
  TopUpRefundNotFoundException,
  TopUpSelfReviewForbiddenException,
} from './exceptions/economy.exceptions';
import {
  TOP_UP_AUDIT_EVENT_TYPES,
  TOP_UP_REFUND_CHANGED_EVENT_TYPE,
} from '@rescom/schemas';

const adminId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const topUpId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const holdJournalId = '55555555-5555-4555-8555-555555555555';

describe('AdminTopUpRefundService', () => {
  const createSetup = () => {
    const repository = new InMemoryPayosTopUpRepository();
    const ledgerRepo = new InMemoryLedgerRepository();
    const ledgerService = new LedgerService(ledgerRepo);
    const unitOfWork = new PassThroughUnitOfWork();

    let currentTime = new Date('2026-10-16T10:00:00Z');

    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: jest.fn().mockResolvedValue({
        id: adminId,
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
      listActiveAdminIds: jest.fn().mockResolvedValue([adminId]),
    };

    const service = new AdminTopUpRefundService({
      repository,
      ledgerService,
      unitOfWork,
      adminCapability,
      logger: { warn: jest.fn(), log: jest.fn() },
      now: () => currentTime,
    });

    const seedRefund = async (overrides: Partial<TopUpRefundRow> = {}) => {
      // Seed top-up row
      repository.rows.set(topUpId, {
        id: topUpId,
        userId,
        orderCode: 1234567,
        amountVnd: 50_000,
        points: 250,
        status: 'SUCCESSFUL',
        checkoutUrl: null,
        paymentLinkId: 'plink-1',
        expiresAt: new Date('2026-10-15T10:00:00Z'),
        cancelledAt: null,
        paidAt: new Date('2026-10-15T09:00:00Z'),
        journalId: 'topup-journal-1',
        pointsCredited: 250,
        amountPaidVnd: 50_000,
        providerReference: 'ref-1',
        counterAccountBankId: '970422',
        counterAccountBankName: 'MBBank',
        counterAccountName: 'NGUYEN VAN A',
        counterAccountNumber: '0123456789',
        createdAt: new Date('2026-10-15T08:50:00Z'),
        channel: 'PAYOS',
      });

      // Credit and place hold in ledger if holdJournalId is not null
      if (overrides.holdJournalId !== null) {
        await ledgerService.creditPayosTopUp({
          topUpId,
          userId,
          points: overrides.points ?? 250,
          orderCode: 1234567,
        });
        await ledgerService.placeTopUpRefundHold({
          requestId,
          userId,
          points: overrides.points ?? 250,
          creditJournalCreatedAt: new Date('2026-10-15T09:00:00Z'),
          orderCode: 1234567,
        });
      }

      // Seed refund request row
      const refundRow: TopUpRefundRow = {
        id: requestId,
        topUpId,
        userId,
        topUpJournalId: 'topup-journal-1',
        holdJournalId,
        releaseJournalId: null,
        status: 'REQUESTED' as const,
        eligibility: 'ELIGIBLE' as const,
        ineligibleReason: null,
        reason: 'OTHER' as const,
        note: 'User changed mind',
        points: 250,
        amountVnd: 50_000,
        counterAccountBankId: '970422',
        counterAccountBankName: 'MBBank',
        counterAccountName: 'NGUYEN VAN A',
        counterAccountNumber: '0123456789',
        destinationVerified: true,
        withdrawnAt: null,
        resolvedAt: null,
        rejectionReason: null,
        manualTransferRecorded: false,
        resolvedByAdminId: null,
        resolveJournalId: null,
        bankTransferReference: null,
        bankTransferredAt: null,
        bankTransferRecordedAt: null,
        correlationId: null,
        createdAt: new Date('2026-10-15T09:30:00Z'),
        updatedAt: new Date('2026-10-15T09:30:00Z'),
        ...overrides,
      };
      repository.refundRequests.set(requestId, refundRow);
      repository.refundRequestsByTopUp.set(topUpId, refundRow);

      // Seed user email and name
      repository.userEmails.set(userId, 'user@example.com');
      repository.userNames.set(userId, 'Nguyen Van A');

      return refundRow;
    };

    return {
      repository,
      ledgerRepo,
      ledgerService,
      adminCapability,
      service,
      seedRefund,
      setTime: (d: Date) => {
        currentTime = d;
      },
    };
  };

  describe('list', () => {
    it('returns paginated items with SLA deadline and overdue computation', async () => {
      const { service, seedRefund, setTime } = createSetup();
      await seedRefund();

      // In business days: Oct 15 2026 (Thursday) -> +3 business days is Oct 20 2026 (Tuesday).
      setTime(new Date('2026-10-19T10:00:00Z'));
      let res = await service.list({ status: 'OPEN' });
      expect(res.total).toBe(1);
      expect(res.pageSize).toBe(10);
      expect(res.items[0]).toMatchObject({
        id: requestId,
        orderCode: 1234567,
        status: 'REQUESTED',
        overdue: false,
      });

      // After SLA (Oct 21): overdue is true
      setTime(new Date('2026-10-21T10:00:00Z'));
      res = await service.list({ status: 'OPEN' });
      expect(res.items[0].overdue).toBe(true);
    });

    it('filters by status and verdict', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund();

      const resolved = await service.list({ status: 'RESOLVED' });
      expect(resolved.total).toBe(0);

      const notEligible = await service.list({ verdict: 'NOT_ELIGIBLE' });
      expect(notEligible.total).toBe(0);

      const openEligible = await service.list({
        status: 'OPEN',
        verdict: 'ELIGIBLE',
      });
      expect(openEligible.total).toBe(1);
    });
  });

  describe('get', () => {
    it('returns detail DTO with full account number for admin', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund();

      const detail = await service.get(requestId);
      expect(detail.id).toBe(requestId);
      expect(detail.destination.accountNumber).toBe('0123456789');
      expect(detail.note).toBe('User changed mind');
    });

    it('throws TopUpRefundNotFoundException if refund not found', async () => {
      const { service } = createSetup();
      await expect(
        service.get('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(TopUpRefundNotFoundException);
    });
  });

  describe('resolve', () => {
    it('forbids non-admin actor', async () => {
      const { service, seedRefund, adminCapability } = createSetup();
      await seedRefund();
      (
        adminCapability.findCurrentCapability as jest.Mock
      ).mockResolvedValueOnce(null);

      await expect(
        service.resolve(
          requestId,
          { decision: 'REFUNDED', destinationConfirmed: true },
          { adminId },
        ),
      ).rejects.toThrow(TopUpAdminCapabilityRequiredException);
    });

    it('forbids self-review if admin is the refund requester', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund({ userId: adminId });

      await expect(
        service.resolve(
          requestId,
          { decision: 'REFUNDED', destinationConfirmed: true },
          { adminId },
        ),
      ).rejects.toThrow(TopUpSelfReviewForbiddenException);
    });

    it('requires destinationConfirmed for REFUNDED when destination is unverified', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund({ destinationVerified: false });

      await expect(
        service.resolve(
          requestId,
          { decision: 'REFUNDED', destinationConfirmed: false },
          { adminId },
        ),
      ).rejects.toThrow(RefundDestinationUnconfirmedException);
      await expect(
        service.resolve(requestId, { decision: 'REFUNDED' }, { adminId }),
      ).rejects.toThrow(RefundDestinationUnconfirmedException);
    });

    it('does not require destinationConfirmed when destination is verified', async () => {
      const { service, seedRefund, repository } = createSetup();
      await seedRefund({ destinationVerified: true });

      const result = await service.resolve(
        requestId,
        { decision: 'REFUNDED' },
        { adminId },
      );

      expect(result.request.status).toBe('REFUNDED');
      expect(repository.refundEvents).toContainEqual(
        expect.objectContaining({
          idempotencyKey: `admin-audit:topup-refund:${requestId}`,
          payload: expect.objectContaining({
            requestId,
            destinationConfirmed: false,
          }),
        }),
      );
    });

    it('checks REFUND_NOT_HELD before destination confirmation', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund({ holdJournalId: null, destinationVerified: false });

      await expect(
        service.resolve(requestId, { decision: 'REFUNDED' }, { adminId }),
      ).rejects.toThrow(RefundNotHeldException);
    });

    it.each([
      ['in the future', '2026-10-16T10:06:00.000Z'],
      ['before the request was created', '2026-10-15T09:29:59.000Z'],
    ])(
      'rejects bankTransferredAt %s with VALIDATION_ERROR',
      async (_label, at) => {
        const { service, seedRefund, ledgerService } = createSetup();
        await seedRefund();
        const refundSpy = jest.spyOn(ledgerService, 'refundTopUpRefundHold');

        await expect(
          service.resolve(
            requestId,
            { decision: 'REFUNDED', bankTransferredAt: at },
            { adminId },
          ),
        ).rejects.toThrow(RefundResolutionValidationException);
        expect(refundSpy).not.toHaveBeenCalled();
      },
    );

    it('rejects REJECTED with manualTransferRecorded on a held request before any posting', async () => {
      const { service, seedRefund, ledgerService } = createSetup();
      await seedRefund();
      const releaseSpy = jest.spyOn(ledgerService, 'releaseTopUpRefundHold');

      await expect(
        service.resolve(
          requestId,
          {
            decision: 'REJECTED',
            reason: 'Paid manually',
            manualTransferRecorded: true,
          },
          { adminId },
        ),
      ).rejects.toThrow(RefundResolutionValidationException);
      expect(releaseSpy).not.toHaveBeenCalled();
    });

    it('throws RefundNotHeldException if hold is missing on REFUNDED decision', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund({ holdJournalId: null });

      await expect(
        service.resolve(
          requestId,
          { decision: 'REFUNDED', destinationConfirmed: true },
          { adminId },
        ),
      ).rejects.toThrow(RefundNotHeldException);
    });

    it('resolves as REFUNDED: executes ledger refund, writes row and outbox events', async () => {
      const { service, seedRefund, ledgerService, repository } = createSetup();
      await seedRefund();
      const refundSpy = jest.spyOn(ledgerService, 'refundTopUpRefundHold');

      const result = await service.resolve(
        requestId,
        {
          decision: 'REFUNDED',
          destinationConfirmed: true,
          bankTransferReference: 'FT261016ABC',
          bankTransferredAt: '2026-10-16T10:05:00.000Z',
        },
        { adminId },
      );

      expect(result.replayed).toBe(false);
      expect(result.request.status).toBe('REFUNDED');
      expect(result.request.bankTransferReference).toBe('FT261016ABC');
      expect(refundSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId,
          userId,
          points: 250,
        }),
      );

      // Verify outbox events
      expect(repository.refundEvents).toContainEqual(
        expect.objectContaining({
          eventType: TOP_UP_REFUND_CHANGED_EVENT_TYPE,
          payload: expect.objectContaining({
            status: 'REFUNDED',
          }),
        }),
      );
      expect(repository.refundEvents).toContainEqual(
        expect.objectContaining({
          eventType: TOP_UP_AUDIT_EVENT_TYPES.REFUND_RESOLVED,
          payload: expect.objectContaining({
            decision: 'REFUNDED',
            adminId,
          }),
        }),
      );
    });

    it('replay of REFUNDED returns replayed: true', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund();

      await service.resolve(
        requestId,
        { decision: 'REFUNDED', destinationConfirmed: true },
        { adminId },
      );

      const replay = await service.resolve(
        requestId,
        { decision: 'REFUNDED', destinationConfirmed: true },
        { adminId },
      );
      expect(replay.replayed).toBe(true);
      expect(replay.request.status).toBe('REFUNDED');
    });

    it('resolves as REJECTED: releases hold, records reason', async () => {
      const { service, seedRefund, ledgerService, repository } = createSetup();
      await seedRefund();
      const releaseSpy = jest.spyOn(ledgerService, 'releaseTopUpRefundHold');

      const result = await service.resolve(
        requestId,
        {
          decision: 'REJECTED',
          reason: 'Duplicate top-up refund claim',
        },
        { adminId },
      );

      expect(result.replayed).toBe(false);
      expect(result.request.status).toBe('REJECTED');
      expect(result.request.rejectionReason).toBe(
        'Duplicate top-up refund claim',
      );
      expect(result.request.manualTransferRecorded).toBe(false);
      expect(repository.refundEvents).toContainEqual(
        expect.objectContaining({
          idempotencyKey: `admin-audit:topup-refund:${requestId}`,
          payload: expect.objectContaining({
            reasonLength: 'Duplicate top-up refund claim'.length,
          }),
        }),
      );
      expect(releaseSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId,
          userId,
          points: 250,
        }),
      );

      // Verify rejection outbox event
      expect(repository.refundEvents).toContainEqual(
        expect.objectContaining({
          eventType: TOP_UP_REFUND_CHANGED_EVENT_TYPE,
          payload: expect.objectContaining({
            status: 'REJECTED',
            rejectionReason: 'Duplicate top-up refund claim',
          }),
        }),
      );
    });

    it('skips ledger call when rejecting hold-less request (pointsHeld = 0)', async () => {
      const { service, seedRefund, ledgerService } = createSetup();
      await seedRefund({ holdJournalId: null });
      const releaseSpy = jest.spyOn(ledgerService, 'releaseTopUpRefundHold');

      const result = await service.resolve(
        requestId,
        { decision: 'REJECTED', reason: 'Not eligible' },
        { adminId },
      );

      expect(result.request.status).toBe('REJECTED');
      expect(releaseSpy).not.toHaveBeenCalled();
    });

    it('records manualTransferRecorded on a hold-less REJECTED request', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund({ holdJournalId: null });

      const result = await service.resolve(
        requestId,
        {
          decision: 'REJECTED',
          reason: 'Paid manually',
          manualTransferRecorded: true,
        },
        { adminId },
      );

      expect(result.request.manualTransferRecorded).toBe(true);
    });

    it('rejects conflict when status is already WITHDRAWN', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund({ status: 'WITHDRAWN', withdrawnAt: new Date() });

      await expect(
        service.resolve(
          requestId,
          { decision: 'REFUNDED', destinationConfirmed: true },
          { adminId },
        ),
      ).rejects.toThrow(RefundAlreadyResolvedException);
    });
  });

  describe('recordBankTransfer', () => {
    it('throws RefundNotRefundedException if status is not REFUNDED', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund({ status: 'REQUESTED' });

      await expect(
        service.recordBankTransfer(
          requestId,
          { bankTransferReference: 'FT123' },
          { adminId },
        ),
      ).rejects.toThrow(RefundNotRefundedException);
    });

    it('replays an identical bank transfer without writing again', async () => {
      const { service, seedRefund, repository } = createSetup();
      await seedRefund({ status: 'REFUNDED', resolvedAt: new Date() });
      const body = {
        bankTransferReference: 'FT999888777',
        bankTransferredAt: '2026-10-16T09:30:00.000Z',
      };

      const first = await service.recordBankTransfer(requestId, body, {
        adminId,
      });
      const eventCount = repository.refundEvents.length;
      const second = await service.recordBankTransfer(requestId, body, {
        adminId,
      });

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.request.bankTransferReference).toBe('FT999888777');
      expect(repository.refundEvents).toHaveLength(eventCount);
    });

    it('throws RefundBankTransferAlreadyRecordedException when a different transfer is sent', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund({ status: 'REFUNDED', resolvedAt: new Date() });
      await service.recordBankTransfer(
        requestId,
        { bankTransferReference: 'FT111' },
        { adminId },
      );

      await expect(
        service.recordBankTransfer(
          requestId,
          { bankTransferReference: 'FT222' },
          { adminId },
        ),
      ).rejects.toThrow(RefundBankTransferAlreadyRecordedException);
    });

    it.each([
      ['in the future', '2026-10-16T10:06:00.000Z'],
      ['before the request was created', '2026-10-15T09:29:59.000Z'],
    ])(
      'rejects bankTransferredAt %s with VALIDATION_ERROR',
      async (_label, at) => {
        const { service, seedRefund } = createSetup();
        await seedRefund({ status: 'REFUNDED', resolvedAt: new Date() });

        await expect(
          service.recordBankTransfer(
            requestId,
            { bankTransferredAt: at },
            { adminId },
          ),
        ).rejects.toThrow(RefundResolutionValidationException);
      },
    );

    it('successfully records bank transfer and emits a text-free audit event', async () => {
      const { service, seedRefund, repository } = createSetup();
      await seedRefund({ status: 'REFUNDED', resolvedAt: new Date() });

      const result = await service.recordBankTransfer(
        requestId,
        {
          bankTransferReference: 'FT999888777',
          bankTransferredAt: '2026-10-16T09:30:00.000Z',
        },
        { adminId },
      );

      expect(result.replayed).toBe(false);
      expect(result.request.bankTransferReference).toBe('FT999888777');
      expect(result.request.bankTransferredAt).toBe('2026-10-16T09:30:00.000Z');
      const audit = repository.refundEvents.find(
        (e) =>
          e.eventType ===
          TOP_UP_AUDIT_EVENT_TYPES.REFUND_BANK_TRANSFER_RECORDED,
      );
      expect(audit?.idempotencyKey).toBe(
        `admin-audit:topup-refund-bank:${requestId}`,
      );
      expect(audit?.payload).toEqual(
        expect.objectContaining({
          requestId,
          hasReference: true,
          hasTransferredAt: true,
        }),
      );
      expect(JSON.stringify(audit?.payload)).not.toContain('FT999888777');
      expect(JSON.stringify(audit?.payload)).not.toContain('09:30');
    });
  });
  describe('replay payload comparison, holdReleased, heldPoints, SLA', () => {
    const outboxUser = (repository: any, decision: string) =>
      repository.refundEvents.find(
        (e: any) =>
          e.eventType === TOP_UP_REFUND_CHANGED_EVENT_TYPE &&
          e.payload.status === decision,
      );

    it('REFUNDED replay with a different bank reference or time -> 409; identical or omitted -> replayed', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund();
      const first = {
        decision: 'REFUNDED',
        destinationConfirmed: true,
        bankTransferReference: 'FT1',
        bankTransferredAt: '2026-10-16T09:00:00.000Z',
      };
      await service.resolve(requestId, first, { adminId });

      expect(
        (await service.resolve(requestId, first, { adminId })).replayed,
      ).toBe(true);
      expect(
        (
          await service.resolve(
            requestId,
            { decision: 'REFUNDED', destinationConfirmed: true },
            { adminId },
          )
        ).replayed,
      ).toBe(true);
      await expect(
        service.resolve(
          requestId,
          { ...first, bankTransferReference: 'FT2' },
          { adminId },
        ),
      ).rejects.toThrow(RefundAlreadyResolvedException);
      await expect(
        service.resolve(
          requestId,
          { ...first, bankTransferredAt: '2026-10-16T09:01:00.000Z' },
          { adminId },
        ),
      ).rejects.toThrow(RefundAlreadyResolvedException);
    });

    it('REJECTED replay with a different reason or manualTransferRecorded -> 409; identical or omitted -> replayed', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund({ holdJournalId: null });
      const first = {
        decision: 'REJECTED',
        reason: 'Paid manually',
        manualTransferRecorded: true,
      };
      await service.resolve(requestId, first, { adminId });

      expect(
        (await service.resolve(requestId, first, { adminId })).replayed,
      ).toBe(true);
      expect(
        (
          await service.resolve(
            requestId,
            { decision: 'REJECTED', reason: 'Paid manually' },
            { adminId },
          )
        ).replayed,
      ).toBe(true);
      await expect(
        service.resolve(requestId, { ...first, reason: 'Other' }, { adminId }),
      ).rejects.toThrow(RefundAlreadyResolvedException);
      await expect(
        service.resolve(
          requestId,
          { ...first, manualTransferRecorded: false },
          { adminId },
        ),
      ).rejects.toThrow(RefundAlreadyResolvedException);
    });

    it('REJECTED event carries holdReleased true when held, false when hold-less', async () => {
      const held = createSetup();
      await held.seedRefund();
      await held.service.resolve(
        requestId,
        { decision: 'REJECTED', reason: 'No' },
        { adminId },
      );
      expect(outboxUser(held.repository, 'REJECTED').payload.holdReleased).toBe(
        true,
      );

      const holdless = createSetup();
      await holdless.seedRefund({ holdJournalId: null });
      await holdless.service.resolve(
        requestId,
        { decision: 'REJECTED', reason: 'No' },
        { adminId },
      );
      expect(
        outboxUser(holdless.repository, 'REJECTED').payload.holdReleased,
      ).toBe(false);
    });

    it('heldPoints is 250 while REQUESTED with a hold and 0 once resolved', async () => {
      const { service, seedRefund } = createSetup();
      await seedRefund();
      expect((await service.get(requestId)).heldPoints).toBe(250);
      expect((await service.list({ status: 'OPEN' })).items[0].heldPoints).toBe(
        250,
      );
      await service.resolve(
        requestId,
        { decision: 'REFUNDED', destinationConfirmed: true },
        { adminId },
      );
      expect((await service.get(requestId)).heldPoints).toBe(0);
      expect(
        (await service.list({ status: 'RESOLVED' })).items[0].heldPoints,
      ).toBe(0);
    });

    it('dueAt skips the weekend and overdue flips at dueAt', async () => {
      const { service, seedRefund, setTime } = createSetup();
      // Fri 2026-10-16 09:30Z -> +3 business days = Wed 2026-10-21 09:30Z
      await seedRefund({ createdAt: new Date('2026-10-16T09:30:00Z') });
      setTime(new Date('2026-10-21T09:29:00Z'));
      let item = (await service.list({ status: 'OPEN' })).items[0];
      expect(item.dueAt).toBe('2026-10-21T09:30:00.000Z');
      expect(item.overdue).toBe(false);
      setTime(new Date('2026-10-21T09:30:00Z'));
      item = (await service.list({ status: 'OPEN' })).items[0];
      expect(item.overdue).toBe(true);
    });
  });
});
