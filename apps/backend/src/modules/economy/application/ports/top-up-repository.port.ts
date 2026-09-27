import { TopUpAdminAuditEventPayload, TopUpStatus } from '@rescom/schemas';
import { TopUpRequestEntity } from '../../domain/top-up-request.entity';

export const TOP_UP_REPOSITORY_PORT = Symbol('TOP_UP_REPOSITORY_PORT');

/**
 * Replayable Moderation admin-audit event appended to the Outbox in the same
 * transaction as the review decision (AD-16).
 */
export interface TopUpAdminAuditOutboxEvent {
  id: string;
  idempotencyKey: string;
  eventType: string;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  payload: TopUpAdminAuditEventPayload;
}

export type CreatePendingTopUpResult =
  | { outcome: 'CREATED'; request: TopUpRequestEntity }
  | { outcome: 'LIMIT_REACHED'; pendingCount: number };

/** A request plus the owner's contact details for the Admin review queue. */
export interface TopUpReviewRecord {
  request: TopUpRequestEntity;
  userEmail: string | null;
}

export interface TopUpPage<T> {
  items: T[];
  total: number;
}

export interface ListUserTopUpsParams {
  limit: number;
  offset: number;
  status?: TopUpStatus;
}

export interface ListTopUpsForReviewParams {
  limit: number;
  offset: number;
  status: TopUpStatus;
}

export interface TopUpRepositoryPort {
  /**
   * Inserts a new PENDING request unless the owner already holds
   * `maxPendingRequests` PENDING requests (checked and inserted atomically per
   * user). Throws `TopUpReferenceConflictException` when the transfer
   * reference is already taken.
   */
  createPending(
    request: TopUpRequestEntity,
    maxPendingRequests: number,
  ): Promise<CreatePendingTopUpResult>;

  findById(id: string): Promise<TopUpRequestEntity | null>;

  /**
   * Reads the request and locks its row until the ambient Unit of Work ends,
   * serialising concurrent reviews of the same request.
   */
  findByIdForUpdate(id: string): Promise<TopUpRequestEntity | null>;

  findReviewRecordById(id: string): Promise<TopUpReviewRecord | null>;

  /** The owner's requests, newest first. */
  listByUser(
    userId: string,
    params: ListUserTopUpsParams,
  ): Promise<TopUpPage<TopUpRequestEntity>>;

  /** Admin queue: PENDING oldest first (FIFO), reviewed requests newest first. */
  listForReview(
    params: ListTopUpsForReviewParams,
  ): Promise<TopUpPage<TopUpReviewRecord>>;

  /**
   * Applies a `PENDING → APPROVED/REJECTED` decision only if the stored row is
   * still PENDING, and appends the admin-audit Outbox event in the same
   * transaction. Returns `null` when the row was no longer PENDING.
   */
  saveReviewDecision(
    decision: TopUpRequestEntity,
    auditEvent: TopUpAdminAuditOutboxEvent,
  ): Promise<TopUpRequestEntity | null>;
}
