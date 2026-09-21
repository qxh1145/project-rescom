import { randomUUID } from 'crypto';
import {
  CreateAttemptWithResponseParams,
  ParticipationRepositoryPort,
  QuotaStatus,
} from '../application/ports/participation-repository.port';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';
import { ResponseEntity } from '../domain/response.entity';
import { IntegrityEventEntity } from '../domain/integrity-event.entity';

export class InMemoryParticipationRepository
  implements ParticipationRepositoryPort
{
  public attempts = new Map<string, SurveyAttemptEntity>();
  public responses = new Map<string, ResponseEntity>();
  public integrityEvents: IntegrityEventEntity[] = [];
  private eventKeys = new Set<string>();

  async hasCompletedLogicalForm(
    respondentId: string,
    formId: string,
  ): Promise<boolean> {
    for (const res of this.responses.values()) {
      if (
        res.respondentId === respondentId &&
        res.formId === formId &&
        (res.status === 'SUBMITTED' || res.status === 'VALIDATED')
      ) {
        return true;
      }
    }
    for (const att of this.attempts.values()) {
      if (
        att.respondentId === respondentId &&
        att.surveyId === formId &&
        att.status === 'COMPLETED'
      ) {
        return true;
      }
    }
    return false;
  }

  async findConflictingActiveAttempt(
    respondentId: string,
    formId: string,
    cutoffDate: Date,
  ): Promise<SurveyAttemptEntity | null> {
    for (const att of this.attempts.values()) {
      if (
        att.respondentId === respondentId &&
        att.surveyId === formId &&
        att.status === 'IN_PROGRESS' &&
        att.startedAt >= cutoffDate
      ) {
        return att;
      }
    }
    return null;
  }

  async abandonExpiredAttempts(
    respondentId: string,
    formId: string,
    cutoffDate: Date,
  ): Promise<number> {
    let count = 0;
    for (const [id, att] of this.attempts.entries()) {
      if (
        att.respondentId === respondentId &&
        att.surveyId === formId &&
        att.status === 'IN_PROGRESS' &&
        att.startedAt < cutoffDate
      ) {
        this.attempts.set(
          id,
          new SurveyAttemptEntity(
            att.id,
            att.surveyId,
            att.formVersionId,
            att.respondentId,
            'ABANDONED',
            att.isGuest,
            att.startedAt,
            att.submittedAt,
            att.clientContext,
            att.createdAt,
            new Date(),
          ),
        );
        count++;
      }
    }
    return count;
  }

  async getQuotaStatus(
    formId: string,
    cutoffDate: Date,
  ): Promise<QuotaStatus> {
    let completedCount = 0;
    for (const res of this.responses.values()) {
      if (
        res.formId === formId &&
        (res.status === 'SUBMITTED' || res.status === 'VALIDATED')
      ) {
        completedCount++;
      }
    }
    let activeReservationCount = 0;
    for (const att of this.attempts.values()) {
      if (
        att.surveyId === formId &&
        att.status === 'IN_PROGRESS' &&
        att.startedAt >= cutoffDate
      ) {
        activeReservationCount++;
      }
    }
    return { completedCount, activeReservationCount };
  }

  async createAttemptWithResponse(
    params: CreateAttemptWithResponseParams,
  ): Promise<{ attempt: SurveyAttemptEntity; response: ResponseEntity | null }> {
    const attempt = new SurveyAttemptEntity(
      params.attemptId,
      params.formId,
      params.formVersionId,
      params.respondentId,
      'IN_PROGRESS',
      params.isGuest,
      params.startedAt,
      null,
      params.clientContext ?? null,
      params.startedAt,
      params.startedAt,
    );
    this.attempts.set(attempt.id, attempt);

    let response: ResponseEntity | null = null;
    if (params.formType === 'INTERNAL') {
      response = new ResponseEntity(
        randomUUID(),
        params.formId,
        params.formVersionId,
        attempt.id,
        params.respondentId,
        'IN_PROGRESS',
        null,
        params.ipAddress,
        params.isGuest,
        null,
        params.startedAt,
        params.startedAt,
      );
      this.responses.set(response.id, response);
    }
    return { attempt, response };
  }

  async findAttemptById(
    attemptId: string,
  ): Promise<SurveyAttemptEntity | null> {
    return this.attempts.get(attemptId) ?? null;
  }

  async findResponseById(
    responseId: string,
  ): Promise<ResponseEntity | null> {
    return this.responses.get(responseId) ?? null;
  }

  async saveIntegrityEvents(
    events: IntegrityEventEntity[],
  ): Promise<number> {
    let addedCount = 0;
    for (const event of events) {
      const key = `${event.attemptId}:${event.clientEventId}`;
      if (!this.eventKeys.has(key)) {
        this.eventKeys.add(key);
        this.integrityEvents.push(event);
        addedCount++;
      }
    }
    return addedCount;
  }
}

