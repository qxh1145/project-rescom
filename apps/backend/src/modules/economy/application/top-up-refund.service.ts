import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  submitTopUpRefundSchema,
  topUpRefundDeadline,
  TopUpRefundResult,
  userTopUpRefundRequestSchema,
  UserTopUpRefundRequest,
  topUpRefundWithdrawKey,
  TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX,
  TOP_UP_REFUND_CHANGED_EVENT_TYPE,
  TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE,
  topUpRefundChangedPayloadSchema,
  topUpRefundAdminNoticePayloadSchema,
} from '@rescom/schemas';
import { UnitOfWorkPort } from '../../../common/database/unit-of-work.port';
import { LedgerService } from './ledger.service';
import {
  PayosTopUpRepositoryPort,
  TopUpRefundRow,
} from './ports/payos-top-up-repository.port';
import {
  RefundAlreadyResolvedException,
  TopUpRefundAlreadyRequestedException,
  TopUpRefundNotAllowedException,
  TopUpRefundNotFoundException,
  TopUpRequestNotFoundException,
} from './exceptions/economy.exceptions';

export class TopUpRefundService {
  constructor(
    private readonly options: {
      repository: PayosTopUpRepositoryPort;
      ledgerService: LedgerService;
      unitOfWork: UnitOfWorkPort;
      logger: Pick<Console, 'warn' | 'log'>;
      now?: () => Date;
      generateId?: () => string;
    },
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private id(): string {
    return this.options.generateId?.() ?? randomUUID();
  }

  async submitRefund(
    topUpId: string,
    rawInput: unknown,
    context: { userId: string; correlationId?: string },
  ): Promise<TopUpRefundResult> {
    const input = submitTopUpRefundSchema.parse(rawInput);
    const key = `topup-refund-submit:${topUpId}`;

    return this.options.unitOfWork.run(key, async () => {
      // 1. Lock TopUpRequest row (AD-24/25 lock order: TopUp -> TopUpRefundRequest -> accounts ascending)
      const row = await this.options.repository.lockTopUpForRefund(topUpId);
      if (!row || row.userId !== context.userId) {
        throw new TopUpRequestNotFoundException(topUpId);
      }

      // 2. Refusals
      if (row.status !== 'SUCCESSFUL') {
        throw new TopUpRefundNotAllowedException('NOT_SUCCESSFUL');
      }
      if (row.channel === 'MANUAL') {
        throw new TopUpRefundNotAllowedException('LEGACY_MANUAL');
      }
      if (
        !row.paidAt ||
        !row.journalId ||
        row.pointsCredited === null ||
        row.amountPaidVnd === null
      ) {
        throw new Error(
          'TopUpRequest has inconsistent payment data for refund',
        );
      }

      const creditJournal = await this.options.repository.findCreditJournal(
        row.journalId,
      );
      if (!creditJournal) {
        throw new Error(`Credit journal not found for top-up ${topUpId}`);
      }
      if (
        creditJournal.idempotencyKey.startsWith(
          TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX,
        )
      ) {
        throw new TopUpRefundNotAllowedException('MISMATCH_CREDITED');
      }

      const deadline = topUpRefundDeadline(row.paidAt);
      const now = this.now();
      if (now >= deadline) {
        throw new TopUpRefundNotAllowedException('DEADLINE_PASSED');
      }

      // 3. Lock TopUpRefundRequest
      const existing =
        await this.options.repository.lockRefundRequestByTopUp(topUpId);
      if (existing) {
        throw new TopUpRefundAlreadyRequestedException();
      }

      // 4. Place hold
      const requestId = this.id();
      const points = row.pointsCredited;
      const holdResult = await this.options.ledgerService.placeTopUpRefundHold({
        requestId,
        userId: row.userId,
        points,
        creditJournalCreatedAt: creditJournal.createdAt,
        orderCode: row.orderCode ?? undefined,
      });

      const eligibility =
        holdResult.outcome === 'HELD' ? 'ELIGIBLE' : 'NOT_ELIGIBLE';
      const ineligibleReason =
        holdResult.outcome === 'NOT_ELIGIBLE' ? holdResult.reason : null;
      const holdJournalId =
        holdResult.outcome === 'HELD' ? holdResult.journalId : null;

      // 5. Destination snapshot (unmasked for storage; last4 for events & user DTO)
      const destinationVerified =
        row.counterAccountBankId != null &&
        row.counterAccountNumber != null &&
        row.counterAccountName != null;
      const destinationLast4 = row.counterAccountNumber
        ? row.counterAccountNumber.length >= 4
          ? row.counterAccountNumber.slice(-4)
          : row.counterAccountNumber
        : null;

      const userEmail = await this.options.repository.getUserEmail(row.userId);
      const correlationId = z.string().uuid().safeParse(context.correlationId)
        .success
        ? context.correlationId!
        : null;

      // 6. Outbox events
      const userEvent = {
        id: this.id(),
        idempotencyKey: `topup-refund-notice:${requestId}:REQUESTED`,
        eventType: TOP_UP_REFUND_CHANGED_EVENT_TYPE,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: requestId,
        aggregateVersion: 1,
        payload: topUpRefundChangedPayloadSchema.parse({
          schemaVersion: 1,
          requestId,
          topUpId,
          userId: row.userId,
          orderCode: row.orderCode!,
          status: 'REQUESTED',
          eligibility,
          ineligibleReason,
          points,
          amountVnd: row.amountPaidVnd,
          occurredAt: now.toISOString(),
        }),
      };

      const adminEvent = {
        id: this.id(),
        idempotencyKey: `topup-refund-admin:${requestId}:REQUESTED`,
        eventType: TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: requestId,
        aggregateVersion: 1,
        payload: topUpRefundAdminNoticePayloadSchema.parse({
          schemaVersion: 1,
          requestId,
          topUpId,
          userId: row.userId,
          orderCode: row.orderCode!,
          status: 'REQUESTED',
          eligibility,
          ineligibleReason,
          points,
          amountVnd: row.amountPaidVnd,
          occurredAt: now.toISOString(),
          userEmail,
          reason: input.reason,
          note: input.note,
          destination: {
            bankId: row.counterAccountBankId,
            bankName: row.counterAccountBankName,
            holderName: row.counterAccountName,
            last4: destinationLast4,
            verified: destinationVerified,
          },
        }),
      };

      // 7. Insert DB row + Outbox events in same transaction
      const refundRow = await this.options.repository.createRefundRequest(
        {
          id: requestId,
          topUpId,
          userId: row.userId,
          topUpJournalId: row.journalId,
          holdJournalId,
          status: 'REQUESTED',
          eligibility,
          ineligibleReason,
          reason: input.reason,
          note: input.note,
          points,
          amountVnd: row.amountPaidVnd,
          counterAccountBankId: row.counterAccountBankId,
          counterAccountBankName: row.counterAccountBankName,
          counterAccountName: row.counterAccountName,
          counterAccountNumber: row.counterAccountNumber,
          destinationVerified,
          correlationId,
          createdAt: now,
        },
        [userEvent, adminEvent],
      );

      return {
        request: this.toUserRefundDto(refundRow),
        replayed: false,
      };
    });
  }

  async withdrawRefund(
    topUpId: string,
    context: { userId: string; correlationId?: string },
  ): Promise<TopUpRefundResult> {
    const key = topUpRefundWithdrawKey(topUpId);

    return this.options.unitOfWork.run(key, async () => {
      // 1. Lock TopUpRequest
      const row = await this.options.repository.lockTopUpForRefund(topUpId);
      if (!row || row.userId !== context.userId) {
        throw new TopUpRequestNotFoundException(topUpId);
      }

      // 2. Lock TopUpRefundRequest
      const refundReq =
        await this.options.repository.lockRefundRequestByTopUp(topUpId);
      if (!refundReq) {
        throw new TopUpRefundNotFoundException(topUpId);
      }

      // 3. Replay check
      if (refundReq.status === 'WITHDRAWN') {
        return {
          request: this.toUserRefundDto(refundReq),
          replayed: true,
        };
      }

      // 4. Conflict check (Story 13.12 terminal statuses)
      if (refundReq.status === 'REFUNDED' || refundReq.status === 'REJECTED') {
        throw new RefundAlreadyResolvedException();
      }

      if (refundReq.status !== 'REQUESTED') {
        throw new Error(`Unexpected refund status ${refundReq.status}`);
      }

      // 5. Release hold journal if hold exists
      let releaseJournalId: string | null = null;
      if (refundReq.holdJournalId) {
        const releaseJournal =
          await this.options.ledgerService.releaseTopUpRefundHold({
            requestId: refundReq.id,
            userId: row.userId,
            points: refundReq.points,
            key: topUpRefundWithdrawKey(refundReq.id),
            orderCode: row.orderCode ?? undefined,
          });
        releaseJournalId = releaseJournal.id;
      }

      const now = this.now();
      const destinationLast4 = refundReq.counterAccountNumber
        ? refundReq.counterAccountNumber.length >= 4
          ? refundReq.counterAccountNumber.slice(-4)
          : refundReq.counterAccountNumber
        : null;
      const userEmail = await this.options.repository.getUserEmail(row.userId);

      // 6. Outbox events
      const userEvent = {
        id: this.id(),
        idempotencyKey: `topup-refund-notice:${refundReq.id}:WITHDRAWN`,
        eventType: TOP_UP_REFUND_CHANGED_EVENT_TYPE,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: refundReq.id,
        aggregateVersion: 2,
        payload: topUpRefundChangedPayloadSchema.parse({
          schemaVersion: 1,
          requestId: refundReq.id,
          topUpId,
          userId: row.userId,
          orderCode: row.orderCode!,
          status: 'WITHDRAWN',
          eligibility: refundReq.eligibility,
          ineligibleReason: refundReq.ineligibleReason,
          points: refundReq.points,
          amountVnd: refundReq.amountVnd,
          holdReleased: releaseJournalId !== null,
          occurredAt: now.toISOString(),
        }),
      };

      const adminEvent = {
        id: this.id(),
        idempotencyKey: `topup-refund-admin:${refundReq.id}:WITHDRAWN`,
        eventType: TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: refundReq.id,
        aggregateVersion: 2,
        payload: topUpRefundAdminNoticePayloadSchema.parse({
          schemaVersion: 1,
          requestId: refundReq.id,
          topUpId,
          userId: row.userId,
          orderCode: row.orderCode!,
          status: 'WITHDRAWN',
          eligibility: refundReq.eligibility,
          ineligibleReason: refundReq.ineligibleReason,
          points: refundReq.points,
          amountVnd: refundReq.amountVnd,
          occurredAt: now.toISOString(),
          userEmail,
          reason: refundReq.reason,
          note: refundReq.note,
          destination: {
            bankId: refundReq.counterAccountBankId,
            bankName: refundReq.counterAccountBankName,
            holderName: refundReq.counterAccountName,
            last4: destinationLast4,
            verified: refundReq.destinationVerified,
          },
        }),
      };

      // 7. CAS withdraw
      const { changed, request: updatedRow } =
        await this.options.repository.withdrawRefundRequest(
          refundReq.id,
          { releaseJournalId, withdrawnAt: now },
          [userEvent, adminEvent],
        );

      if (!changed) {
        throw new Error('Withdrawal CAS failed');
      }

      return {
        request: this.toUserRefundDto(updatedRow),
        replayed: false,
      };
    });
  }

  private toUserRefundDto(row: TopUpRefundRow): UserTopUpRefundRequest {
    const last4 = row.counterAccountNumber
      ? row.counterAccountNumber.length >= 4
        ? row.counterAccountNumber.slice(-4)
        : row.counterAccountNumber
      : null;
    return userTopUpRefundRequestSchema.parse({
      id: row.id,
      status: row.status,
      eligibility: row.eligibility,
      ineligibleReason: row.ineligibleReason,
      reason: row.reason,
      points: row.points,
      amountVnd: row.amountVnd,
      destination: {
        bankId: row.counterAccountBankId,
        bankName: row.counterAccountBankName,
        holderName: row.counterAccountName,
        last4,
        accountNumber: row.counterAccountNumber,
        verified: row.destinationVerified,
      },
      submittedAt: row.createdAt.toISOString(),
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      bankTransferReference: row.bankTransferReference,
      bankTransferredAt: row.bankTransferredAt?.toISOString() ?? null,
    });
  }
}
