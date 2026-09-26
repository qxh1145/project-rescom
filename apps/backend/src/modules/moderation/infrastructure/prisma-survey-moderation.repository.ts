import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SurveyModerationDecision as SurveyModerationDecisionRow,
} from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  currentClient,
  runInTransaction,
} from '../../../common/database/prisma-unit-of-work';
import { SurveyModerationDecisionEntity } from '../domain/survey-moderation-decision.entity';
import {
  SurveyModerationAuditOutboxEvent,
  SurveyModerationRepositoryPort,
} from '../application/ports/survey-moderation-repository.port';
import { ModerationAlreadyDecidedException } from '../application/exceptions/moderation.exceptions';

/**
 * PostgreSQL persistence for survey moderation decisions (Story 8.1). Writes
 * join the caller's Unit of Work (AD-16), so the decision, its admin-audit
 * Outbox event, the Form transition and the Escrow refund commit or roll back
 * together.
 */
@Injectable()
export class PrismaSurveyModerationRepository implements SurveyModerationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Joins the ambient Unit of Work (Epic 8 review P5): inside the
   * `moderation:{formVersionId}` transaction the read sees the Unit of Work's
   * own writes and borrows no second pooled connection.
   */
  async findByFormVersionId(
    formVersionId: string,
  ): Promise<SurveyModerationDecisionEntity | null> {
    const row = await currentClient(
      this.prisma,
    ).surveyModerationDecision.findUnique({
      where: { formVersionId },
    });
    return row ? toEntity(row) : null;
  }

  async saveDecision(
    decision: SurveyModerationDecisionEntity,
    auditEvent: SurveyModerationAuditOutboxEvent,
  ): Promise<SurveyModerationDecisionEntity> {
    try {
      return await runInTransaction(this.prisma, async (tx) => {
        const created = await tx.surveyModerationDecision.create({
          data: {
            id: decision.id,
            formId: decision.formId,
            formVersionId: decision.formVersionId,
            versionNumber: decision.versionNumber,
            outcome: decision.outcome,
            adminId: decision.adminId,
            reason: decision.reason,
            refundAmount: decision.refundAmount,
            refundJournalId: decision.refundJournalId,
            correlationId: decision.correlationId,
            decidedAt: decision.decidedAt,
          },
        });

        // Replayable Moderation admin-audit event, same transaction (AD-16).
        await tx.outboxEvent.create({
          data: {
            id: auditEvent.id,
            idempotencyKey: auditEvent.idempotencyKey,
            eventType: auditEvent.eventType,
            schemaVersion: auditEvent.payload.schemaVersion,
            producer: auditEvent.producer,
            aggregateType: auditEvent.aggregateType,
            aggregateId: auditEvent.aggregateId,
            aggregateVersion: auditEvent.aggregateVersion,
            correlationId: auditEvent.correlationId,
            status: 'PENDING',
            payload: auditEvent.payload as unknown as Prisma.InputJsonValue,
          },
        });

        return toEntity(created);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent decision for this FormVersion committed first.
        throw new ModerationAlreadyDecidedException(
          decision.formId,
          'ALREADY_DECIDED',
        );
      }
      throw error;
    }
  }
}

function toEntity(
  row: SurveyModerationDecisionRow,
): SurveyModerationDecisionEntity {
  return new SurveyModerationDecisionEntity({
    id: row.id,
    formId: row.formId,
    formVersionId: row.formVersionId,
    versionNumber: row.versionNumber,
    outcome: row.outcome,
    adminId: row.adminId,
    reason: row.reason,
    refundAmount: row.refundAmount,
    refundJournalId: row.refundJournalId,
    correlationId: row.correlationId,
    decidedAt: row.decidedAt,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
