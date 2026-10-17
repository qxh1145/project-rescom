import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  AdminTopUpRefundDetail,
  adminTopUpRefundDetailSchema,
  AdminTopUpRefundListItem,
  adminTopUpRefundListItemSchema,
  adminTopUpRefundListQuerySchema,
  AdminTopUpRefundListResponse,
  adminTopUpRefundListResponseSchema,
  AdminResolveTopUpRefundResult,
  adminResolveTopUpRefundResultSchema,
  resolveTopUpRefundSchema,
  recordTopUpRefundBankTransferSchema,
  TOP_UP_REFUND_SLA_BUSINESS_DAYS,
  topUpRefundResolveKey,
  TOP_UP_REFUND_CHANGED_EVENT_TYPE,
  topUpRefundChangedPayloadSchema,
  TOP_UP_AUDIT_EVENT_TYPES,
  addBusinessDays,
} from '@rescom/schemas';
import { UnitOfWorkPort } from '../../../common/database/unit-of-work.port';
import { LedgerService } from './ledger.service';
import {
  AdminRefundDetailRow,
  AdminRefundListItemRow,
  PayosTopUpRepositoryPort,
} from './ports/payos-top-up-repository.port';
import { AdminCapabilityPort } from './ports/admin-capability.port';
import {
  RefundAlreadyResolvedException,
  RefundBankTransferAlreadyRecordedException,
  RefundDestinationUnconfirmedException,
  RefundNotHeldException,
  RefundNotRefundedException,
  RefundResolutionValidationException,
  TopUpAdminCapabilityRequiredException,
  TopUpRefundNotFoundException,
  TopUpRequestNotFoundException,
  TopUpSelfReviewForbiddenException,
} from './exceptions/economy.exceptions';

export class AdminTopUpRefundService {
  constructor(
    private readonly options: {
      repository: PayosTopUpRepositoryPort;
      ledgerService: LedgerService;
      unitOfWork: UnitOfWorkPort;
      adminCapability?: AdminCapabilityPort;
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

  private async assertAdminCapability(adminId: string): Promise<void> {
    const capability =
      await this.options.adminCapability?.findCurrentCapability(adminId);
    if (
      !capability ||
      capability.role !== 'ADMIN' ||
      capability.status !== 'ACTIVE'
    ) {
      throw new TopUpAdminCapabilityRequiredException();
    }
  }

  private assertBankTransferredAt(
    value: string | undefined,
    refundCreatedAt: Date,
    now: Date,
  ): void {
    if (!value) return;
    const at = new Date(value).getTime();
    if (at > now.getTime() + 5 * 60 * 1000 || at < refundCreatedAt.getTime()) {
      throw new RefundResolutionValidationException('Validation failed', [
        { path: 'bankTransferredAt', code: 'out_of_range' },
      ]);
    }
  }

  async list(
    rawQuery: unknown,
    currentTime?: Date,
  ): Promise<AdminTopUpRefundListResponse> {
    const query = adminTopUpRefundListQuerySchema.parse(rawQuery);
    const now = currentTime ?? this.now();
    const pageSize = 10;

    const { items, total } =
      await this.options.repository.listRefundRequestsForAdmin({
        status: query.status,
        verdict: query.verdict,
        q: query.q,
        page: query.page,
        pageSize,
      });

    const mappedItems: AdminTopUpRefundListItem[] = items.map((row) =>
      this.toListItemDto(row, now),
    );

    return adminTopUpRefundListResponseSchema.parse({
      items: mappedItems,
      total,
      page: query.page,
      pageSize,
    });
  }

  async get(id: string, currentTime?: Date): Promise<AdminTopUpRefundDetail> {
    const row = await this.options.repository.findRefundRequestForAdmin(id);
    if (!row) {
      throw new TopUpRefundNotFoundException(id);
    }
    const now = currentTime ?? this.now();
    return this.toDetailDto(row, now);
  }

  async resolve(
    requestId: string,
    rawInput: unknown,
    context: { adminId: string; correlationId?: string },
  ): Promise<AdminResolveTopUpRefundResult> {
    await this.assertAdminCapability(context.adminId);
    const input = resolveTopUpRefundSchema.parse(rawInput);

    const existing =
      await this.options.repository.findRefundRequestForAdmin(requestId);
    if (!existing) {
      throw new TopUpRefundNotFoundException(requestId);
    }

    if (existing.userId === context.adminId) {
      throw new TopUpSelfReviewForbiddenException();
    }

    const key = topUpRefundResolveKey(requestId);

    return this.options.unitOfWork.run(key, async () => {
      // 1. Lock TopUpRequest (AD-24/25 lock order: TopUp -> TopUpRefundRequest -> accounts ascending)
      const topUp = await this.options.repository.lockTopUpForRefund(
        existing.topUpId,
      );
      if (!topUp || topUp.orderCode == null) {
        throw new TopUpRequestNotFoundException(existing.topUpId);
      }
      const orderCode = topUp.orderCode;

      // 2. Lock TopUpRefundRequest
      const refund =
        await this.options.repository.lockRefundRequestById(requestId);
      if (!refund) {
        throw new TopUpRefundNotFoundException(requestId);
      }

      // 3. Replay check
      if (refund.status === 'REFUNDED' && input.decision === 'REFUNDED') {
        // Replay is idempotent only for an identical payload; omitted fields are not differences.
        if (
          (input.bankTransferReference !== undefined &&
            input.bankTransferReference !== refund.bankTransferReference) ||
          (input.bankTransferredAt !== undefined &&
            new Date(input.bankTransferredAt).getTime() !==
              (refund.bankTransferredAt?.getTime() ?? null))
        ) {
          throw new RefundAlreadyResolvedException();
        }
        const detail = await this.get(requestId);
        return adminResolveTopUpRefundResultSchema.parse({
          request: detail,
          replayed: true,
        });
      }

      if (refund.status === 'REJECTED' && input.decision === 'REJECTED') {
        const manualSent =
          typeof rawInput === 'object' &&
          rawInput !== null &&
          (rawInput as Record<string, unknown>).manualTransferRecorded !==
            undefined;
        if (
          input.reason !== refund.rejectionReason ||
          (manualSent &&
            input.manualTransferRecorded !== refund.manualTransferRecorded)
        ) {
          throw new RefundAlreadyResolvedException();
        }
        const detail = await this.get(requestId);
        return adminResolveTopUpRefundResultSchema.parse({
          request: detail,
          replayed: true,
        });
      }

      if (refund.status !== 'REQUESTED') {
        throw new RefundAlreadyResolvedException();
      }

      const now = this.now();
      let resolveJournalId: string | null = null;
      let bankTransferReference: string | null = null;
      let bankTransferredAt: Date | null = null;
      let bankTransferRecordedAt: Date | null = null;
      let rejectionReason: string | null = null;
      let manualTransferRecorded = false;

      if (input.decision === 'REFUNDED') {
        if (!refund.holdJournalId || refund.points <= 0) {
          throw new RefundNotHeldException();
        }
        if (
          !refund.destinationVerified &&
          input.destinationConfirmed !== true
        ) {
          throw new RefundDestinationUnconfirmedException();
        }
        this.assertBankTransferredAt(
          input.bankTransferredAt,
          refund.createdAt,
          now,
        );

        const resolveJournal =
          await this.options.ledgerService.refundTopUpRefundHold({
            requestId,
            orderCode,
            topUpId: topUp.id,
            userId: refund.userId,
            points: refund.points,
          });
        resolveJournalId = resolveJournal.id;

        if (input.bankTransferReference || input.bankTransferredAt) {
          bankTransferReference = input.bankTransferReference ?? null;
          bankTransferredAt = input.bankTransferredAt
            ? new Date(input.bankTransferredAt)
            : null;
          bankTransferRecordedAt = now;
        }
      } else {
        // REJECTED
        if (refund.holdJournalId && input.manualTransferRecorded) {
          throw new RefundResolutionValidationException('Validation failed', [
            { path: 'manualTransferRecorded', code: 'not_allowed_when_held' },
          ]);
        }
        if (refund.holdJournalId && refund.points > 0) {
          const releaseJournal =
            await this.options.ledgerService.releaseTopUpRefundHold({
              requestId,
              userId: refund.userId,
              points: refund.points,
              key: topUpRefundResolveKey(requestId),
              orderCode,
            });
          resolveJournalId = releaseJournal.id;
        }

        rejectionReason = input.reason;
        manualTransferRecorded = input.manualTransferRecorded ?? false;
      }

      const correlationId = z.string().uuid().safeParse(context.correlationId)
        .success
        ? context.correlationId!
        : null;

      const userEvent = {
        id: this.id(),
        idempotencyKey: `topup-refund-notice:${requestId}:${input.decision}`,
        eventType: TOP_UP_REFUND_CHANGED_EVENT_TYPE,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: requestId,
        aggregateVersion: 3,
        payload: topUpRefundChangedPayloadSchema.parse({
          schemaVersion: 1,
          requestId,
          topUpId: topUp.id,
          userId: refund.userId,
          orderCode,
          status: input.decision,
          eligibility: refund.eligibility,
          ineligibleReason: refund.ineligibleReason,
          points: refund.points,
          amountVnd: refund.amountVnd,
          rejectionReason:
            input.decision === 'REJECTED' ? input.reason : undefined,
          holdReleased:
            input.decision === 'REJECTED'
              ? resolveJournalId !== null
              : undefined,
          occurredAt: now.toISOString(),
        }),
      };

      const auditEvent = {
        id: this.id(),
        idempotencyKey: `admin-audit:topup-refund:${requestId}`,
        eventType: TOP_UP_AUDIT_EVENT_TYPES.REFUND_RESOLVED,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: requestId,
        aggregateVersion: 1,
        payload: {
          schemaVersion: 1,
          action: 'TOPUP_REFUND_RESOLVED',
          auditCategory: 'MODERATION_ADMIN_ACTION',
          requestId,
          topUpId: topUp.id,
          adminId: context.adminId,
          decision: input.decision,
          correlationId,
          occurredAt: now.toISOString(),
          ...(input.decision === 'REJECTED'
            ? {
                reasonLength: input.reason.length,
                manualTransferRecorded: input.manualTransferRecorded ?? false,
              }
            : { destinationConfirmed: input.destinationConfirmed === true }),
        },
      };

      const { changed } = await this.options.repository.resolveRefundRequest(
        requestId,
        {
          status: input.decision,
          resolvedAt: now,
          resolvedByAdminId: context.adminId,
          resolveJournalId,
          rejectionReason,
          manualTransferRecorded,
          bankTransferReference,
          bankTransferredAt,
          bankTransferRecordedAt,
        },
        [userEvent, auditEvent],
      );

      if (!changed) {
        throw new Error('Refund resolution CAS failed');
      }

      const detail = await this.get(requestId);
      return adminResolveTopUpRefundResultSchema.parse({
        request: detail,
        replayed: false,
      });
    });
  }

  async recordBankTransfer(
    requestId: string,
    rawInput: unknown,
    context: { adminId: string; correlationId?: string },
  ): Promise<AdminResolveTopUpRefundResult> {
    await this.assertAdminCapability(context.adminId);
    const input = recordTopUpRefundBankTransferSchema.parse(rawInput);

    const existing =
      await this.options.repository.findRefundRequestForAdmin(requestId);
    if (!existing) {
      throw new TopUpRefundNotFoundException(requestId);
    }

    const key = `topup-refund-bank-transfer:${requestId}`;

    return this.options.unitOfWork.run(key, async () => {
      // Same lock order as resolve: TopUp -> TopUpRefundRequest
      const topUp = await this.options.repository.lockTopUpForRefund(
        existing.topUpId,
      );
      if (!topUp) {
        throw new TopUpRequestNotFoundException(existing.topUpId);
      }
      const refund =
        await this.options.repository.lockRefundRequestById(requestId);
      if (!refund) {
        throw new TopUpRefundNotFoundException(requestId);
      }

      if (refund.status !== 'REFUNDED') {
        throw new RefundNotRefundedException();
      }

      if (refund.userId === context.adminId) {
        throw new TopUpSelfReviewForbiddenException();
      }

      const incomingReference = input.bankTransferReference ?? null;
      const incomingAt = input.bankTransferredAt
        ? new Date(input.bankTransferredAt)
        : null;

      if (refund.bankTransferReference || refund.bankTransferRecordedAt) {
        if (
          incomingReference === refund.bankTransferReference &&
          (incomingAt?.getTime() ?? null) ===
            (refund.bankTransferredAt?.getTime() ?? null)
        ) {
          return adminResolveTopUpRefundResultSchema.parse({
            request: await this.get(requestId),
            replayed: true,
          });
        }
        throw new RefundBankTransferAlreadyRecordedException();
      }

      const now = this.now();
      this.assertBankTransferredAt(
        input.bankTransferredAt,
        refund.createdAt,
        now,
      );
      const correlationId = z.string().uuid().safeParse(context.correlationId)
        .success
        ? context.correlationId!
        : null;

      const auditEvent = {
        id: this.id(),
        idempotencyKey: `admin-audit:topup-refund-bank:${requestId}`,
        eventType: TOP_UP_AUDIT_EVENT_TYPES.REFUND_BANK_TRANSFER_RECORDED,
        producer: 'economy-service',
        aggregateType: 'TopUpRefundRequest',
        aggregateId: requestId,
        aggregateVersion: 1,
        payload: {
          schemaVersion: 1,
          action: 'TOPUP_REFUND_BANK_TRANSFER_RECORDED',
          auditCategory: 'MODERATION_ADMIN_ACTION',
          requestId,
          topUpId: refund.topUpId,
          adminId: context.adminId,
          hasReference: incomingReference !== null,
          hasTransferredAt: incomingAt !== null,
          correlationId,
          occurredAt: now.toISOString(),
        },
      };

      const { changed } =
        await this.options.repository.recordRefundBankTransfer(
          requestId,
          {
            bankTransferReference: incomingReference,
            bankTransferredAt: incomingAt,
            recordedAt: now,
          },
          [auditEvent],
        );

      if (!changed) {
        throw new RefundBankTransferAlreadyRecordedException();
      }

      return adminResolveTopUpRefundResultSchema.parse({
        request: await this.get(requestId),
        replayed: false,
      });
    });
  }

  private toListItemDto(
    row: AdminRefundListItemRow,
    now: Date,
  ): AdminTopUpRefundListItem {
    const dueAt = addBusinessDays(
      row.submittedAt,
      TOP_UP_REFUND_SLA_BUSINESS_DAYS,
    );
    const overdue =
      row.status === 'REQUESTED' && now.getTime() >= dueAt.getTime();

    return adminTopUpRefundListItemSchema.parse({
      id: row.id,
      topUpId: row.topUpId,
      orderCode: row.orderCode,
      userId: row.userId,
      userEmail: row.userEmail,
      userName: row.userName,
      amountVnd: row.amountVnd,
      points: row.points,
      status: row.status,
      eligibility: row.eligibility,
      ineligibleReason: row.ineligibleReason,
      reason: row.reason,
      destinationVerified: row.destinationVerified,
      heldPoints: row.heldPoints,
      submittedAt: row.submittedAt.toISOString(),
      dueAt: dueAt.toISOString(),
      overdue,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    });
  }

  private toDetailDto(
    row: AdminRefundDetailRow,
    now: Date,
  ): AdminTopUpRefundDetail {
    const dueAt = addBusinessDays(
      row.submittedAt,
      TOP_UP_REFUND_SLA_BUSINESS_DAYS,
    );
    const overdue =
      row.status === 'REQUESTED' && now.getTime() >= dueAt.getTime();

    return adminTopUpRefundDetailSchema.parse({
      id: row.id,
      topUpId: row.topUpId,
      orderCode: row.orderCode,
      userId: row.userId,
      userEmail: row.userEmail,
      userName: row.userName,
      amountVnd: row.amountVnd,
      points: row.points,
      status: row.status,
      eligibility: row.eligibility,
      ineligibleReason: row.ineligibleReason,
      reason: row.reason,
      destinationVerified: row.destinationVerified,
      heldPoints: row.heldPoints,
      submittedAt: row.submittedAt.toISOString(),
      dueAt: dueAt.toISOString(),
      overdue,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      note: row.note,
      paidAt: row.paidAt.toISOString(),
      providerReference: row.providerReference,
      destination: {
        bankId: row.counterAccountBankId,
        bankName: row.counterAccountBankName,
        holderName: row.counterAccountName,
        accountNumber: row.counterAccountNumber,
        verified: row.destinationVerified,
      },
      rejectionReason: row.rejectionReason,
      manualTransferRecorded: row.manualTransferRecorded,
      bankTransferReference: row.bankTransferReference,
      bankTransferredAt: row.bankTransferredAt?.toISOString() ?? null,
      bankTransferRecordedAt: row.bankTransferRecordedAt?.toISOString() ?? null,
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      resolvedBy: row.resolvedByAdminId
        ? {
            id: row.resolvedByAdminId,
            email: row.resolvedByAdminEmail,
          }
        : null,
      holdJournalId: row.holdJournalId,
      resolveJournalId: row.resolveJournalId,
    });
  }
}
