import { randomBytes, randomUUID } from 'crypto';
import {
  AdminTopUpRequestDto,
  AdminTopUpRequestListDto,
  TOP_UP_AUDIT_EVENT_TYPES,
  TOP_UP_MAX_PENDING_REQUESTS,
  TOP_UP_REFERENCE_CODE_LENGTH,
  TopUpAdminAuditEventPayload,
  TopUpPaymentInstructionsDto,
  TopUpRequestDto,
  TopUpRequestListDto,
  TopUpReviewResultDto,
  buildTopUpReference,
  buildVietQrPayload,
  createTopUpRequestSchema,
  listTopUpRequestsQuerySchema,
  pointsToVnd,
  rejectTopUpRequestSchema,
  topUpAdminAuditEventPayloadSchema,
  topUpApprovalKey,
  topUpRejectionKey,
  truncateText,
} from '@rescom/schemas';
import { z } from 'zod';
import {
  PassThroughUnitOfWork,
  UnitOfWorkPort,
} from '../../../common/database/unit-of-work.port';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import { TopUpRequestEntity } from '../domain/top-up-request.entity';
import { LedgerService } from './ledger.service';
import { AdminCapabilityPort } from './ports/admin-capability.port';
import {
  TopUpAdminAuditOutboxEvent,
  TopUpRepositoryPort,
  TopUpReviewRecord,
} from './ports/top-up-repository.port';
import {
  InvalidTopUpRequestException,
  TopUpAdminCapabilityRequiredException,
  TopUpAlreadyReviewedException,
  TopUpPendingLimitExceededException,
  TopUpReferenceConflictException,
  TopUpRequestNotFoundException,
  TopUpSelfReviewForbiddenException,
} from './exceptions/economy.exceptions';

/** Platform bank account shown on the transfer instructions (from configuration). */
export interface TopUpPaymentConfig {
  bankName: string;
  bankBin: string;
  accountNumber: string;
  accountName: string;
}

export interface TopUpServiceDependencies {
  repository: TopUpRepositoryPort;
  ledgerService: LedgerService;
  adminCapability: AdminCapabilityPort;
  /** Read lazily so the configuration is only required when a request is served. */
  paymentConfig: () => TopUpPaymentConfig;
  unitOfWork?: UnitOfWorkPort;
  notificationPublisher?: NotificationPublisherPort;
  generateReference?: () => string;
  generateId?: () => string;
  now?: () => Date;
}

export interface ApproveTopUpCommand {
  topUpId: string;
  adminId: string;
  correlationId?: string | null;
}

export interface RejectTopUpCommand extends ApproveTopUpCommand {
  reason: unknown;
}

const REFERENCE_ATTEMPTS = 3;
const AUDIT_PRODUCER = 'economy-service';
const AUDIT_AGGREGATE_TYPE = 'TopUpRequest';
/** Created = version 1, reviewed = version 2. */
const REVIEWED_AGGREGATE_VERSION = 2;
const NOTIFICATION_REASON_MAX_LENGTH = 300;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReviewOutcome {
  request: TopUpRequestEntity;
  replayed: boolean;
}

/**
 * Manual Point top-up (Story 6.6, FR-34/FR-35).
 *
 * `approveTopUp` is the AD-16 `ApproveTopUp` coordinator: under one Unit of
 * Work keyed `topup-approval:{topUpId}` it locks the request, re-verifies the
 * actor's live Admin capability, posts exactly one Ledger journal, applies the
 * approval and appends the replayable Moderation admin-audit Outbox event.
 * Notifications go out only after the Unit of Work committed.
 */
export class TopUpService {
  private readonly repository: TopUpRepositoryPort;
  private readonly ledgerService: LedgerService;
  private readonly adminCapability: AdminCapabilityPort;
  private readonly paymentConfig: () => TopUpPaymentConfig;
  private readonly unitOfWork: UnitOfWorkPort;
  private readonly notificationPublisher?: NotificationPublisherPort;
  private readonly generateReference: () => string;
  private readonly generateId: () => string;
  private readonly now: () => Date;

  constructor(deps: TopUpServiceDependencies) {
    this.repository = deps.repository;
    this.ledgerService = deps.ledgerService;
    this.adminCapability = deps.adminCapability;
    this.paymentConfig = deps.paymentConfig;
    this.unitOfWork = deps.unitOfWork ?? new PassThroughUnitOfWork();
    this.notificationPublisher = deps.notificationPublisher;
    this.generateReference =
      deps.generateReference ??
      (() => buildTopUpReference(randomBytes(TOP_UP_REFERENCE_CODE_LENGTH)));
    this.generateId = deps.generateId ?? randomUUID;
    this.now = deps.now ?? (() => new Date());
  }

  /** FR-34: creates a "Pending Payment" request with transfer instructions. */
  async createRequest(
    userId: string,
    input: unknown,
  ): Promise<TopUpRequestDto> {
    const { amount } = this.parse(createTopUpRequestSchema, input);
    const amountVnd = pointsToVnd(amount);

    for (let attempt = 1; attempt <= REFERENCE_ATTEMPTS; attempt += 1) {
      const request = TopUpRequestEntity.create({
        id: this.generateId(),
        userId,
        amount,
        amountVnd,
        transferReference: this.generateReference(),
        createdAt: this.now(),
      });

      try {
        const result = await this.repository.createPending(
          request,
          TOP_UP_MAX_PENDING_REQUESTS,
        );
        if (result.outcome === 'LIMIT_REACHED') {
          throw new TopUpPendingLimitExceededException(
            TOP_UP_MAX_PENDING_REQUESTS,
          );
        }
        return this.toOwnerDto(result.request);
      } catch (error) {
        if (
          error instanceof TopUpReferenceConflictException &&
          attempt < REFERENCE_ATTEMPTS
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new TopUpReferenceConflictException();
  }

  /** The caller's own requests, newest first. */
  async listMyRequests(
    userId: string,
    query: unknown,
  ): Promise<TopUpRequestListDto> {
    const { limit, offset, status } = this.parse(
      listTopUpRequestsQuerySchema,
      query ?? {},
    );
    const page = await this.repository.listByUser(userId, {
      limit,
      offset,
      status,
    });
    return {
      items: page.items.map((request) => this.toOwnerDto(request)),
      total: page.total,
      limit,
      offset,
      hasMore: offset + page.items.length < page.total,
    };
  }

  /** Admin queue (FR-35): PENDING by default, oldest first. */
  async listForReview(query: unknown): Promise<AdminTopUpRequestListDto> {
    const { limit, offset, status } = this.parse(
      listTopUpRequestsQuerySchema,
      query ?? {},
    );
    const page = await this.repository.listForReview({
      limit,
      offset,
      status: status ?? 'PENDING',
    });
    return {
      items: page.items.map((record) => this.toAdminDto(record)),
      total: page.total,
      limit,
      offset,
      hasMore: offset + page.items.length < page.total,
    };
  }

  /** FR-35 / AD-16 `ApproveTopUp` coordinator. */
  async approveTopUp(
    command: ApproveTopUpCommand,
  ): Promise<TopUpReviewResultDto> {
    const correlationId = this.resolveCorrelationId(command.correlationId);
    const ledgerKey = topUpApprovalKey(command.topUpId);

    const outcome = await this.unitOfWork.run<ReviewOutcome>(
      ledgerKey,
      async () => {
        const current = await this.lockForReview(
          command.topUpId,
          command.adminId,
        );
        if (current.status === 'APPROVED') {
          return { request: current, replayed: true };
        }
        if (current.status !== 'PENDING') {
          throw new TopUpAlreadyReviewedException(current.id, current.status);
        }

        const journal = await this.ledgerService.creditApprovedTopUp({
          topUpId: current.id,
          userId: current.userId,
          amount: current.amount,
          transferReference: current.transferReference,
        });

        const approved = current.approve({
          adminId: command.adminId,
          journalId: journal.id,
          correlationId,
          reviewedAt: this.now(),
        });
        const saved = await this.repository.saveReviewDecision(
          approved,
          this.buildAuditEvent(approved, 'TOPUP_APPROVED', correlationId),
        );
        if (saved) {
          return { request: saved, replayed: false };
        }
        return this.resolveLostTransition(current.id, 'APPROVED');
      },
    );

    await this.notifyApproved(outcome.request);
    return this.toReviewResult(outcome);
  }

  /** FR-35: rejects with a reason; no Points move. */
  async rejectTopUp(
    command: RejectTopUpCommand,
  ): Promise<TopUpReviewResultDto> {
    const { reason } = this.parse(rejectTopUpRequestSchema, {
      reason: command.reason,
    });
    const correlationId = this.resolveCorrelationId(command.correlationId);

    const outcome = await this.unitOfWork.run<ReviewOutcome>(
      topUpRejectionKey(command.topUpId),
      async () => {
        const current = await this.lockForReview(
          command.topUpId,
          command.adminId,
        );
        if (current.status === 'REJECTED') {
          return { request: current, replayed: true };
        }
        if (current.status !== 'PENDING') {
          throw new TopUpAlreadyReviewedException(current.id, current.status);
        }

        const rejected = current.reject({
          adminId: command.adminId,
          reason,
          correlationId,
          reviewedAt: this.now(),
        });
        const saved = await this.repository.saveReviewDecision(
          rejected,
          this.buildAuditEvent(rejected, 'TOPUP_REJECTED', correlationId),
        );
        if (saved) {
          return { request: saved, replayed: false };
        }
        return this.resolveLostTransition(current.id, 'REJECTED');
      },
    );

    await this.notifyRejected(outcome.request);
    return this.toReviewResult(outcome);
  }

  /**
   * Locks the request row, then re-verifies the actor's live capability
   * inside the same Unit of Work (not the JWT role).
   */
  private async lockForReview(
    topUpId: string,
    adminId: string,
  ): Promise<TopUpRequestEntity> {
    const current = await this.repository.findByIdForUpdate(topUpId);
    if (!current) {
      throw new TopUpRequestNotFoundException(topUpId);
    }

    const capability =
      await this.adminCapability.findCurrentCapability(adminId);
    if (
      !capability ||
      capability.role !== 'ADMIN' ||
      capability.status !== 'ACTIVE'
    ) {
      throw new TopUpAdminCapabilityRequiredException();
    }
    if (current.userId === adminId) {
      throw new TopUpSelfReviewForbiddenException();
    }
    return current;
  }

  /**
   * The conditional transition found the row no longer PENDING (a concurrent
   * reviewer won). Same decision → return it as a replay; otherwise conflict.
   */
  private async resolveLostTransition(
    topUpId: string,
    intended: 'APPROVED' | 'REJECTED',
  ): Promise<ReviewOutcome> {
    const winner = await this.repository.findById(topUpId);
    if (!winner) {
      throw new TopUpRequestNotFoundException(topUpId);
    }
    if (winner.status === intended) {
      return { request: winner, replayed: true };
    }
    throw new TopUpAlreadyReviewedException(winner.id, winner.status);
  }

  private buildAuditEvent(
    request: TopUpRequestEntity,
    action: 'TOPUP_APPROVED' | 'TOPUP_REJECTED',
    correlationId: string,
  ): TopUpAdminAuditOutboxEvent {
    const isApproval = action === 'TOPUP_APPROVED';
    const decisionKey = isApproval
      ? topUpApprovalKey(request.id)
      : topUpRejectionKey(request.id);

    const payload: TopUpAdminAuditEventPayload =
      topUpAdminAuditEventPayloadSchema.parse({
        schemaVersion: 1,
        auditCategory: 'MODERATION_ADMIN_ACTION',
        action,
        topUpId: request.id,
        userId: request.userId,
        adminId: request.adminId,
        amount: request.amount,
        amountVnd: request.amountVnd,
        transferReference: request.transferReference,
        journalId: request.journalId,
        ledgerIdempotencyKey: isApproval ? decisionKey : null,
        rejectionReason: request.rejectionReason,
        correlationId,
        occurredAt: (request.reviewedAt ?? this.now()).toISOString(),
      });

    return {
      id: this.generateId(),
      idempotencyKey: `admin-audit:${decisionKey}`,
      eventType: isApproval
        ? TOP_UP_AUDIT_EVENT_TYPES.APPROVED
        : TOP_UP_AUDIT_EVENT_TYPES.REJECTED,
      producer: AUDIT_PRODUCER,
      aggregateType: AUDIT_AGGREGATE_TYPE,
      aggregateId: request.id,
      aggregateVersion: REVIEWED_AGGREGATE_VERSION,
      correlationId,
      payload,
    };
  }

  /** TOPUP_SUCCESS (FR-57); replays re-publish and the port deduplicates. */
  private async notifyApproved(request: TopUpRequestEntity): Promise<void> {
    await this.notificationPublisher?.publish({
      userId: request.userId,
      type: 'TOPUP_SUCCESS',
      message: `Your top-up ${request.transferReference} was approved: ${request.amount} points (${request.amountVnd} VND) have been added to your Available balance.`,
      dedupeKey: topUpApprovalKey(request.id),
    });
  }

  private async notifyRejected(request: TopUpRequestEntity): Promise<void> {
    const reason = request.rejectionReason ?? '';
    // Epic 9 review P9: never split an emoji (a lone surrogate fails the
    // publish and the notice is lost).
    const shortReason = truncateText(reason, NOTIFICATION_REASON_MAX_LENGTH);
    // Story IR.4b B3: its own type (was WARNING), so it can also be emailed;
    // the dedupe key is unchanged.
    await this.notificationPublisher?.publish({
      userId: request.userId,
      type: 'TOPUP_REJECTED',
      message: `Your top-up request ${request.transferReference} for ${request.amount} points was rejected. Reason: ${shortReason}`,
      dedupeKey: topUpRejectionKey(request.id),
    });
  }

  private async toReviewResult(
    outcome: ReviewOutcome,
  ): Promise<TopUpReviewResultDto> {
    const record = (await this.repository.findReviewRecordById(
      outcome.request.id,
    )) ?? { request: outcome.request, userEmail: null };
    return {
      topUp: this.toAdminDto(record),
      journalId: outcome.request.journalId,
      replayed: outcome.replayed,
    };
  }

  private toOwnerDto(request: TopUpRequestEntity): TopUpRequestDto {
    return {
      id: request.id,
      amount: request.amount,
      amountVnd: request.amountVnd,
      status: request.status,
      transferReference: request.transferReference,
      rejectionReason: request.rejectionReason,
      createdAt: request.createdAt.toISOString(),
      reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
      paymentInstructions: request.isPending()
        ? this.buildPaymentInstructions(request)
        : null,
    };
  }

  private toAdminDto(record: TopUpReviewRecord): AdminTopUpRequestDto {
    const { request } = record;
    return {
      ...this.toOwnerDto(request),
      userId: request.userId,
      userEmail: record.userEmail,
      adminId: request.adminId,
      journalId: request.journalId,
      correlationId: request.correlationId,
    };
  }

  private buildPaymentInstructions(
    request: TopUpRequestEntity,
  ): TopUpPaymentInstructionsDto {
    const config = this.paymentConfig();
    return {
      bankName: config.bankName,
      bankBin: config.bankBin,
      accountNumber: config.accountNumber,
      accountName: config.accountName,
      amountVnd: request.amountVnd,
      transferContent: request.transferReference,
      qrPayload: buildVietQrPayload({
        bankBin: config.bankBin,
        accountNumber: config.accountNumber,
        amountVnd: request.amountVnd,
        transferContent: request.transferReference,
      }),
    };
  }

  private resolveCorrelationId(candidate?: string | null): string {
    return candidate && UUID_PATTERN.test(candidate)
      ? candidate.toLowerCase()
      : this.generateId();
  }

  private parse<S extends z.ZodTypeAny>(
    schema: S,
    value: unknown,
  ): z.output<S> {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new InvalidTopUpRequestException(
        result.error.errors[0]?.message ?? 'The top-up request is invalid.',
      );
    }
    return result.data;
  }
}
