import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { SurveyAttemptEntity, AttemptStatus } from '../domain/survey-attempt.entity';
import { ResponseEntity, ResponseStatus } from '../domain/response.entity';
import { IntegrityEventEntity } from '../domain/integrity-event.entity';
import {
  CreateAttemptWithResponseParams,
  ParticipationRepositoryPort,
  QuotaStatus,
} from '../application/ports/participation-repository.port';

function toAttemptEntity(raw: any): SurveyAttemptEntity {
  return new SurveyAttemptEntity(
    raw.id,
    raw.surveyId,
    raw.formVersionId,
    raw.respondentId,
    raw.status as AttemptStatus,
    raw.isGuest,
    raw.startedAt,
    raw.submittedAt,
    (raw.clientContext as Record<string, unknown> | null) ?? null,
    raw.createdAt,
    raw.updatedAt,
  );
}

function toResponseEntity(raw: any): ResponseEntity {
  return new ResponseEntity(
    raw.id,
    raw.formId,
    raw.formVersionId,
    raw.attemptId,
    raw.respondentId,
    raw.status as ResponseStatus,
    (raw.answersJson as Record<string, unknown> | null) ?? null,
    raw.ipAddress,
    raw.isGuest,
    raw.submittedAt,
    raw.createdAt,
    raw.updatedAt,
  );
}

@Injectable()
export class PrismaParticipationRepository implements ParticipationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async hasCompletedLogicalForm(
    respondentId: string,
    formId: string,
  ): Promise<boolean> {
    const completedResponse = await this.prisma.response.findFirst({
      where: {
        respondentId,
        formId,
        status: { in: ['SUBMITTED', 'VALIDATED'] },
      },
      select: { id: true },
    });
    if (completedResponse) return true;

    const completedAttempt = await this.prisma.surveyAttempt.findFirst({
      where: {
        respondentId,
        surveyId: formId,
        status: 'COMPLETED',
      },
      select: { id: true },
    });
    return Boolean(completedAttempt);
  }

  async findConflictingActiveAttempt(
    respondentId: string,
    formId: string,
    cutoffDate: Date,
  ): Promise<SurveyAttemptEntity | null> {
    const attempt = await this.prisma.surveyAttempt.findFirst({
      where: {
        respondentId,
        surveyId: formId,
        status: 'IN_PROGRESS',
        startedAt: { gte: cutoffDate },
      },
    });
    if (!attempt) return null;
    return toAttemptEntity(attempt);
  }

  async abandonExpiredAttempts(
    respondentId: string,
    formId: string,
    cutoffDate: Date,
  ): Promise<number> {
    const result = await this.prisma.surveyAttempt.updateMany({
      where: {
        respondentId,
        surveyId: formId,
        status: 'IN_PROGRESS',
        startedAt: { lt: cutoffDate },
      },
      data: {
        status: 'ABANDONED',
      },
    });
    return result.count;
  }

  async getQuotaStatus(
    formId: string,
    cutoffDate: Date,
  ): Promise<QuotaStatus> {
    const [completedCount, activeReservationCount] = await Promise.all([
      this.prisma.response.count({
        where: {
          formId,
          status: { in: ['SUBMITTED', 'VALIDATED'] },
        },
      }),
      this.prisma.surveyAttempt.count({
        where: {
          surveyId: formId,
          status: 'IN_PROGRESS',
          startedAt: { gte: cutoffDate },
        },
      }),
    ]);
    return { completedCount, activeReservationCount };
  }

  async createAttemptWithResponse(
    params: CreateAttemptWithResponseParams,
  ): Promise<{ attempt: SurveyAttemptEntity; response: ResponseEntity | null }> {
    return this.prisma.$transaction(async (tx) => {
      const createdAttempt = await tx.surveyAttempt.create({
        data: {
          id: params.attemptId,
          surveyId: params.formId,
          formVersionId: params.formVersionId,
          respondentId: params.respondentId,
          status: 'IN_PROGRESS',
          isGuest: params.isGuest,
          startedAt: params.startedAt,
          clientContext: params.clientContext
            ? (params.clientContext as any)
            : undefined,
        },
      });

      let createdResponse: any = null;
      if (params.formType === 'INTERNAL') {
        createdResponse = await tx.response.create({
          data: {
            formId: params.formId,
            formVersionId: params.formVersionId,
            attemptId: createdAttempt.id,
            respondentId: params.respondentId,
            status: 'IN_PROGRESS',
            ipAddress: params.ipAddress,
            isGuest: params.isGuest,
          },
        });
      }

      return {
        attempt: toAttemptEntity(createdAttempt),
        response: createdResponse ? toResponseEntity(createdResponse) : null,
      };
    });
  }

  async findAttemptById(
    attemptId: string,
  ): Promise<SurveyAttemptEntity | null> {
    const raw = await this.prisma.surveyAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!raw) return null;
    return toAttemptEntity(raw);
  }

  async findResponseById(
    responseId: string,
  ): Promise<ResponseEntity | null> {
    const raw = await this.prisma.response.findUnique({
      where: { id: responseId },
    });
    if (!raw) return null;
    return toResponseEntity(raw);
  }

  async saveIntegrityEvents(
    events: IntegrityEventEntity[],
  ): Promise<number> {
    if (events.length === 0) return 0;

    const result = await this.prisma.integrityEvent.createMany({
      data: events.map((event) => ({
        clientEventId: event.clientEventId,
        eventType: event.eventType as any,
        attemptId: event.attemptId,
        formVersionId: event.formVersionId,
        respondentId: event.respondentId,
        questionId: event.questionId ?? undefined,
        sequence: event.sequence ?? undefined,
        occurredAt: event.occurredAt,
        metadata: event.metadata ? (event.metadata as any) : undefined,
        consentId: event.consentId ?? undefined,
      })),
      skipDuplicates: true,
    });

    return result.count;
  }
}

