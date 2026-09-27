import { TopUpRequestEntity } from '../domain/top-up-request.entity';
import {
  CreatePendingTopUpResult,
  ListTopUpsForReviewParams,
  ListUserTopUpsParams,
  TopUpAdminAuditOutboxEvent,
  TopUpPage,
  TopUpRepositoryPort,
  TopUpReviewRecord,
} from '../application/ports/top-up-repository.port';
import { TopUpReferenceConflictException } from '../application/exceptions/economy.exceptions';

/**
 * In-memory adapter for unit tests and e2e overrides. Mirrors the Prisma
 * adapter: unique transfer references, per-user pending limit, conditional
 * `PENDING → APPROVED/REJECTED` transitions and Outbox audit events.
 */
export class InMemoryTopUpRepository implements TopUpRepositoryPort {
  readonly outboxEvents: TopUpAdminAuditOutboxEvent[] = [];
  private readonly requests = new Map<string, TopUpRequestEntity>();
  private readonly insertionOrder = new Map<string, number>();
  private readonly userEmails = new Map<string, string>();
  private sequence = 0;

  /** Test helper: the owner email returned to the Admin review queue. */
  setUserEmail(userId: string, email: string): void {
    this.userEmails.set(userId, email);
  }

  async createPending(
    request: TopUpRequestEntity,
    maxPendingRequests: number,
  ): Promise<CreatePendingTopUpResult> {
    const referenceTaken = [...this.requests.values()].some(
      (existing) => existing.transferReference === request.transferReference,
    );
    if (referenceTaken) {
      throw new TopUpReferenceConflictException();
    }

    const pendingCount = [...this.requests.values()].filter(
      (existing) =>
        existing.userId === request.userId && existing.status === 'PENDING',
    ).length;
    if (pendingCount >= maxPendingRequests) {
      return { outcome: 'LIMIT_REACHED', pendingCount };
    }

    this.requests.set(request.id, request);
    this.insertionOrder.set(request.id, this.sequence++);
    return { outcome: 'CREATED', request };
  }

  async findById(id: string): Promise<TopUpRequestEntity | null> {
    return this.requests.get(id) ?? null;
  }

  async findByIdForUpdate(id: string): Promise<TopUpRequestEntity | null> {
    return this.findById(id);
  }

  async findReviewRecordById(id: string): Promise<TopUpReviewRecord | null> {
    const request = this.requests.get(id);
    return request ? this.toReviewRecord(request) : null;
  }

  async listByUser(
    userId: string,
    params: ListUserTopUpsParams,
  ): Promise<TopUpPage<TopUpRequestEntity>> {
    const filtered = this.sorted('desc').filter(
      (request) =>
        request.userId === userId &&
        (!params.status || request.status === params.status),
    );
    return {
      items: filtered.slice(params.offset, params.offset + params.limit),
      total: filtered.length,
    };
  }

  async listForReview(
    params: ListTopUpsForReviewParams,
  ): Promise<TopUpPage<TopUpReviewRecord>> {
    const filtered = this.sorted(
      params.status === 'PENDING' ? 'asc' : 'desc',
    ).filter((request) => request.status === params.status);
    return {
      items: filtered
        .slice(params.offset, params.offset + params.limit)
        .map((request) => this.toReviewRecord(request)),
      total: filtered.length,
    };
  }

  async saveReviewDecision(
    decision: TopUpRequestEntity,
    auditEvent: TopUpAdminAuditOutboxEvent,
  ): Promise<TopUpRequestEntity | null> {
    const current = this.requests.get(decision.id);
    if (!current || current.status !== 'PENDING') {
      return null;
    }
    if (
      this.outboxEvents.some(
        (event) => event.idempotencyKey === auditEvent.idempotencyKey,
      )
    ) {
      throw new Error(
        `Outbox event ${auditEvent.idempotencyKey} already exists.`,
      );
    }

    this.requests.set(decision.id, decision);
    this.outboxEvents.push(auditEvent);
    return decision;
  }

  private sorted(direction: 'asc' | 'desc'): TopUpRequestEntity[] {
    const factor = direction === 'asc' ? 1 : -1;
    return [...this.requests.values()].sort(
      (a, b) =>
        factor *
        (a.createdAt.getTime() - b.createdAt.getTime() ||
          (this.insertionOrder.get(a.id) ?? 0) -
            (this.insertionOrder.get(b.id) ?? 0)),
    );
  }

  private toReviewRecord(request: TopUpRequestEntity): TopUpReviewRecord {
    return {
      request,
      userEmail: this.userEmails.get(request.userId) ?? null,
    };
  }
}
