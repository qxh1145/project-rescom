import { SurveyAttemptEntity } from '../../domain/survey-attempt.entity';
import { ResponseEntity } from '../../domain/response.entity';
import { IntegrityEventEntity } from '../../domain/integrity-event.entity';

export const PARTICIPATION_REPOSITORY_PORT = Symbol(
  'PARTICIPATION_REPOSITORY_PORT',
);

export interface CreateAttemptWithResponseParams {
  attemptId: string;
  formId: string;
  formVersionId: string;
  respondentId: string | null;
  isGuest: boolean;
  formType: 'INTERNAL' | 'EXTERNAL';
  clientContext?: Record<string, unknown>;
  ipAddress: string;
  startedAt: Date;
}

export interface QuotaStatus {
  completedCount: number;
  activeReservationCount: number;
}

export interface ParticipationRepositoryPort {
  /**
   * Checks if an authenticated respondent has already completed a Response for this logical form.
   */
  hasCompletedLogicalForm(
    respondentId: string,
    formId: string,
  ): Promise<boolean>;

  /**
   * Finds an active IN_PROGRESS attempt for the respondent on this form started on or after cutoffDate.
   */
  findConflictingActiveAttempt(
    respondentId: string,
    formId: string,
    cutoffDate: Date,
  ): Promise<SurveyAttemptEntity | null>;

  /**
   * Lazily marks expired attempts for this respondent and form as ABANDONED.
   */
  abandonExpiredAttempts(
    respondentId: string,
    formId: string,
    cutoffDate: Date,
  ): Promise<number>;

  /**
   * Retrieves the current quota usage (completed responses + active unexpired reservations).
   */
  getQuotaStatus(formId: string, cutoffDate: Date): Promise<QuotaStatus>;

  /**
   * Atomically commits a SurveyAttempt, expiring reservation, and (if INTERNAL)
   * a one-to-one IN_PROGRESS Response identity within a single database transaction.
   */
  createAttemptWithResponse(
    params: CreateAttemptWithResponseParams,
  ): Promise<{ attempt: SurveyAttemptEntity; response: ResponseEntity | null }>;

  /**
   * Finds an attempt by its ID.
   */
  findAttemptById(attemptId: string): Promise<SurveyAttemptEntity | null>;

  /**
   * Finds a response by its ID.
   */
  findResponseById(responseId: string): Promise<ResponseEntity | null>;

  /**
   * Idempotently persists a batch of behavioral integrity events.
   * Duplicate events with identical (attemptId, clientEventId) are skipped.
   */
  saveIntegrityEvents(events: IntegrityEventEntity[]): Promise<number>;
}

