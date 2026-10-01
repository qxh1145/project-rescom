import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { keysetCursorOf, parseKeysetCursor } from '@rescom/schemas';
import { PrismaService } from '../../database/prisma.service';
import { currentClient } from '../../database/prisma-unit-of-work';
import { OutboxEnvelope } from './outbox-handler';
import {
  DeadLetterPage,
  OutboxBacklog,
  OutboxClaimRepository,
  OutboxFailure,
  RedriveResult,
} from './outbox-claim.repository';

interface ClaimedRow {
  id: string;
  idempotency_key: string;
  event_type: string;
  schema_version: number;
  producer: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  ordering_stream: string | null;
  stream_sequence: number | null;
  correlation_id: string | null;
  causation_id: string | null;
  payload: unknown;
  attempts: number;
  created_at: Date;
}

/**
 * Story IR.2b Task 4.3 (AD-10). Touches only `outbox_events` and
 * `processed_handlers`. The claim's `$now` comes from the scheduler clock.
 */
@Injectable()
export class PrismaOutboxClaimRepository implements OutboxClaimRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimBatch(params: {
    types: string[];
    owner: string;
    fencingToken: string;
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<OutboxEnvelope[]> {
    if (params.types.length === 0 || params.limit <= 0) return [];
    const expiresAt = new Date(params.now.getTime() + params.leaseMs);
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      WITH candidates AS (
        SELECT o.id FROM outbox_events o
        WHERE o.event_type = ANY(${params.types}::text[])
          AND o.status IN ('PENDING', 'FAILED')
          AND o.available_at <= ${params.now}
          AND (o.claim_expires_at IS NULL OR o.claim_expires_at < ${params.now})
          AND (o.ordering_stream IS NULL OR NOT EXISTS (
                SELECT 1 FROM outbox_events p
                WHERE p.ordering_stream = o.ordering_stream
                  AND p.stream_sequence < o.stream_sequence
                  AND p.status <> 'PROCESSED'))
        ORDER BY o.available_at, o.created_at, o.id
        LIMIT ${params.limit}
        FOR UPDATE OF o SKIP LOCKED)
      UPDATE outbox_events e
         SET claim_owner = ${params.owner},
             claim_fencing_token = ${params.fencingToken},
             claim_expires_at = ${expiresAt},
             attempts = e.attempts + 1,
             updated_at = ${params.now}
        FROM candidates c
       WHERE e.id = c.id
      RETURNING e.id::text AS id, e.idempotency_key, e.event_type,
                e.schema_version, e.producer, e.aggregate_type,
                e.aggregate_id, e.aggregate_version, e.ordering_stream,
                e.stream_sequence, e.correlation_id::text AS correlation_id,
                e.causation_id::text AS causation_id, e.payload, e.attempts,
                e.created_at
    `;
    return rows
      .map((row): OutboxEnvelope => ({
        id: row.id,
        idempotencyKey: row.idempotency_key,
        eventType: row.event_type,
        schemaVersion: Number(row.schema_version),
        producer: row.producer,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        aggregateVersion: Number(row.aggregate_version),
        orderingStream: row.ordering_stream,
        streamSequence:
          row.stream_sequence === null ? null : Number(row.stream_sequence),
        correlationId: row.correlation_id,
        causationId: row.causation_id,
        payload: row.payload,
        attempts: Number(row.attempts),
        createdAt: row.created_at,
      }))
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
  }

  async lockClaimed(
    eventId: string,
    owner: string,
    fencingToken: string,
  ): Promise<boolean> {
    const rows = await currentClient(this.prisma).$queryRaw<
      Array<{ id: string }>
    >`
      SELECT id FROM outbox_events
      WHERE id = ${eventId}::uuid
        AND claim_owner = ${owner}
        AND claim_fencing_token = ${fencingToken}
      FOR UPDATE
    `;
    return rows.length === 1;
  }

  async processedHandlerNames(eventId: string): Promise<Set<string>> {
    const rows = await currentClient(this.prisma).processedHandler.findMany({
      where: { eventId },
      select: { handlerName: true },
    });
    return new Set(rows.map((row) => row.handlerName));
  }

  async recordProcessed(
    handlerName: string,
    eventId: string,
    streamSequence: number | null,
    now: Date,
  ): Promise<void> {
    await currentClient(this.prisma).processedHandler.create({
      data: { handlerName, eventId, streamSequence, processedAt: now },
    });
  }

  async markProcessed(eventId: string, now: Date): Promise<void> {
    await currentClient(this.prisma).outboxEvent.update({
      where: { id: eventId },
      data: {
        status: 'PROCESSED',
        processedAt: now,
        claimOwner: null,
        claimFencingToken: null,
        claimExpiresAt: null,
        lastError: null,
        updatedAt: now,
      },
    });
  }

  async releaseClaim(
    eventId: string,
    owner: string,
    fencingToken: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox_events
         SET claim_owner = NULL, claim_fencing_token = NULL,
             claim_expires_at = NULL, attempts = GREATEST(attempts - 1, 0)
       WHERE id = ${eventId}::uuid
         AND claim_owner = ${owner}
         AND claim_fencing_token = ${fencingToken}
    `;
  }

  async recordFailure(
    eventId: string,
    owner: string,
    fencingToken: string,
    now: Date,
    failure: OutboxFailure,
  ): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: {
        id: eventId,
        claimOwner: owner,
        claimFencingToken: fencingToken,
      },
      data: {
        status: failure.status,
        availableAt: failure.availableAt,
        lastError: failure.lastError,
        terminalState: failure.terminalState,
        claimOwner: null,
        claimFencingToken: null,
        claimExpiresAt: null,
        updatedAt: now,
      },
    });
    return result.count === 1;
  }

  async backlog(subscribedTypes: string[], now: Date): Promise<OutboxBacklog> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        pending: bigint;
        retrying: bigint;
        dead_letter: bigint;
        unsubscribed_pending: bigint;
        oldest: Date | null;
      }>
    >`
      SELECT
        count(*) FILTER (WHERE status = 'PENDING' AND event_type = ANY(${subscribedTypes}::text[])) AS pending,
        count(*) FILTER (WHERE status = 'FAILED' AND event_type = ANY(${subscribedTypes}::text[])) AS retrying,
        count(*) FILTER (WHERE status = 'DEAD_LETTER') AS dead_letter,
        count(*) FILTER (WHERE status = 'PENDING' AND NOT (event_type = ANY(${subscribedTypes}::text[]))) AS unsubscribed_pending,
        min(available_at) FILTER (
          WHERE status IN ('PENDING', 'FAILED')
            AND event_type = ANY(${subscribedTypes}::text[])
            AND available_at <= ${now}
        ) AS oldest
      FROM outbox_events
      WHERE status IN ('PENDING', 'FAILED', 'DEAD_LETTER')
    `;
    return {
      pending: Number(row?.pending ?? 0),
      retrying: Number(row?.retrying ?? 0),
      deadLetter: Number(row?.dead_letter ?? 0),
      unsubscribedPending: Number(row?.unsubscribed_pending ?? 0),
      oldestAvailableAgeSeconds: row?.oldest
        ? Math.max(0, Math.floor((now.getTime() - row.oldest.getTime()) / 1000))
        : null,
    };
  }

  async listDeadLetters(
    limit: number,
    cursor: string | null,
  ): Promise<DeadLetterPage> {
    const after = cursor ? parseKeysetCursor(cursor) : null;
    const where: Prisma.OutboxEventWhereInput = { status: 'DEAD_LETTER' };
    if (after) {
      const createdAt = new Date(after.createdAt);
      where.OR = [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: after.id } },
      ];
    }
    const rows = await this.prisma.outboxEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        eventType: true,
        aggregateType: true,
        aggregateId: true,
        attempts: true,
        terminalState: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: rows.length > limit && last ? keysetCursorOf(last) : null,
    };
  }

  async redrive(
    eventId: string,
    now: Date,
    adminId: string,
  ): Promise<RedriveResult> {
    const redriven = await this.prisma.$transaction(async (tx) => {
      const result = await tx.outboxEvent.updateMany({
        where: { id: eventId, status: 'DEAD_LETTER' },
        data: {
          status: 'PENDING',
          attempts: 0,
          availableAt: now,
          terminalState: null,
          claimOwner: null,
          claimFencingToken: null,
          claimExpiresAt: null,
          updatedAt: now,
        },
      });
      if (result.count !== 1) return false;
      // Same row shape as `PrismaIdentityAuditRepository.append`.
      await tx.identityAuditLog.create({
        data: {
          action: 'OUTBOX_EVENT_REDRIVEN',
          userId: adminId,
          outcome: 'SUCCESS',
          metadata: { eventId },
        },
      });
      return true;
    });
    if (redriven) return 'REDRIVEN';
    const exists = await this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    return exists ? 'NOT_DEAD_LETTER' : 'NOT_FOUND';
  }
}
