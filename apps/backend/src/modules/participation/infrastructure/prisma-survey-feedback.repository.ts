import { Injectable } from '@nestjs/common';
import { Prisma, SurveyFeedback as SurveyFeedbackRow } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { SurveyFeedbackEntity } from '../domain/survey-feedback.entity';
import {
  CreateSurveyFeedbackResult,
  SurveyFeedbackRepositoryPort,
  SurveyFeedbackSubmittedOutboxEvent,
} from '../application/ports/survey-feedback-repository.port';

/**
 * PostgreSQL persistence for post-completion feedback (Story 9.2). The
 * feedback row and its `SurveyFeedbackSubmitted` Outbox event commit in one
 * transaction (AD-10). A unique violation on `attempt_id` aborts that
 * transaction, so it is handled outside it by re-reading the stored row.
 */
@Injectable()
export class PrismaSurveyFeedbackRepository implements SurveyFeedbackRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByAttemptId(
    attemptId: string,
  ): Promise<SurveyFeedbackEntity | null> {
    const row = await this.prisma.surveyFeedback.findUnique({
      where: { attemptId },
    });
    return row ? toEntity(row) : null;
  }

  async createWithOutboxEvent(
    feedback: SurveyFeedbackEntity,
    event: SurveyFeedbackSubmittedOutboxEvent,
  ): Promise<CreateSurveyFeedbackResult> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.surveyFeedback.create({
          data: {
            id: feedback.id,
            attemptId: feedback.attemptId,
            responseId: feedback.responseId,
            formId: feedback.formId,
            formVersionId: feedback.formVersionId,
            respondentId: feedback.respondentId,
            formType: feedback.formType,
            rating: feedback.rating,
            comment: feedback.comment,
            issueTags: feedback.issueTags,
            validationStatus: feedback.validationStatus,
            validatedAt: feedback.validatedAt,
            submittedAt: feedback.submittedAt,
          },
        });

        await tx.outboxEvent.create({
          data: {
            id: event.id,
            idempotencyKey: event.idempotencyKey,
            eventType: event.eventType,
            schemaVersion: event.schemaVersion,
            producer: event.producer,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            aggregateVersion: 1,
            status: 'PENDING',
            payload: event.payload as unknown as Prisma.InputJsonValue,
          },
        });

        return row;
      });
      return { created: true, feedback: toEntity(created) };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // A concurrent submission for this attempt committed first.
      const existing = await this.findByAttemptId(feedback.attemptId);
      if (!existing) {
        throw error;
      }
      return { created: false, feedback: existing };
    }
  }
}

function toEntity(row: SurveyFeedbackRow): SurveyFeedbackEntity {
  return new SurveyFeedbackEntity({
    id: row.id,
    attemptId: row.attemptId,
    responseId: row.responseId,
    formId: row.formId,
    formVersionId: row.formVersionId,
    respondentId: row.respondentId,
    formType: row.formType,
    rating: row.rating,
    comment: row.comment,
    issueTags: row.issueTags,
    validationStatus: row.validationStatus,
    validatedAt: row.validatedAt,
    submittedAt: row.submittedAt,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
