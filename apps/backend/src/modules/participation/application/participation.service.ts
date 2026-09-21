import { randomUUID } from 'crypto';
import {
  isSurveyTargetingMatch,
  StartSurveyAttemptInput,
  SurveyAttemptResponseDto,
  SurveyTargetingCriteria,
  BatchTelemetryEventsInput,
  TelemetryIngestionResponseDto,
} from '@rescom/schemas';
import { FormRepositoryPort } from '../../forms/application/ports/form-repository.port';
import { DemographicProfileRepositoryPort } from '../../users/application/ports/demographic-profile.repository.port';
import { ParticipationRepositoryPort } from './ports/participation-repository.port';
import { IntegrityEventEntity } from '../domain/integrity-event.entity';
import {
  ConflictingActiveAttemptException,
  ParticipantNotEligibleException,
  SurveyAlreadyCompletedException,
  SurveyNotAvailableException,
  SurveyQuotaFullException,
} from './exceptions/participation.exceptions';
import { createStorageCapability } from '../../../common/security/storage-capability';

export const RESERVATION_EXPIRY_MINUTES = 30;

export class ParticipationService {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly demographicRepository: DemographicProfileRepositoryPort,
    private readonly participationRepository: ParticipationRepositoryPort,
  ) {}

  /**
   * Initializes a survey attempt with concurrency checks and expiring quota reservation.
   * Internal start creates a durable Response record in the same transaction (FR-ADD-9, AD-19).
   */
  async startAttempt(
    formId: string,
    userId: string | null,
    input: StartSurveyAttemptInput,
    clientIp: string,
  ): Promise<SurveyAttemptResponseDto> {
    // 1. Verify exact Form and FormVersion are published/open
    const formWithVersion = await this.formRepository.findById(formId);
    if (!formWithVersion) {
      throw new SurveyNotAvailableException(
        `Survey with ID "${formId}" was not found.`,
      );
    }

    const { form, currentVersion } = formWithVersion;

    if (!form.isPublished() || !currentVersion.isPublished) {
      throw new SurveyNotAvailableException(
        `Survey "${formId}" is not published or currently active for participation.`,
      );
    }

    // 2. Verify targeting eligibility for authenticated participants
    if (userId) {
      const profileEntity = await this.demographicRepository.findByUserId(userId);
      const profileDto = profileEntity ? profileEntity.toDto() : null;
      const targeting = (currentVersion.targetingJson ??
        null) as SurveyTargetingCriteria | null;

      const isEligible = isSurveyTargetingMatch(targeting, profileDto);
      if (!isEligible) {
        throw new ParticipantNotEligibleException();
      }
    }

    // 3. Enforce one-completion per authenticated account at logical Form level (FR-25, AD-19)
    if (userId) {
      const hasCompleted =
        await this.participationRepository.hasCompletedLogicalForm(
          userId,
          form.id,
        );
      if (hasCompleted) {
        throw new SurveyAlreadyCompletedException();
      }
    }

    // 4. Concurrency, quota reservation & conflicting active attempt checks
    const now = new Date();
    const cutoffDate = new Date(
      now.getTime() - RESERVATION_EXPIRY_MINUTES * 60 * 1000,
    );

    if (userId) {
      // Lazily abandon any expired attempts for this participant
      await this.participationRepository.abandonExpiredAttempts(
        userId,
        form.id,
        cutoffDate,
      );

      // Check for an existing unexpired active attempt
      const activeAttempt =
        await this.participationRepository.findConflictingActiveAttempt(
          userId,
          form.id,
          cutoffDate,
        );
      if (activeAttempt) {
        throw new ConflictingActiveAttemptException();
      }
    }

    // 5. Quota check: completed responses + active reservations < expectedCompletions
    const { completedCount, activeReservationCount } =
      await this.participationRepository.getQuotaStatus(form.id, cutoffDate);

    if (completedCount + activeReservationCount >= form.expectedCompletions) {
      throw new SurveyQuotaFullException();
    }

    // 6. Transactional creation of Attempt + (if INTERNAL) durable Response identity
    const attemptId = randomUUID();
    const startedAt = now;
    const expiresAt = new Date(
      startedAt.getTime() + RESERVATION_EXPIRY_MINUTES * 60 * 1000,
    );

    const isGuest = !userId;
    const { attempt, response } =
      await this.participationRepository.createAttemptWithResponse({
        attemptId,
        formId: form.id,
        formVersionId: currentVersion.id,
        respondentId: userId,
        isGuest,
        formType: form.type,
        clientContext: input.clientContext,
        ipAddress: clientIp,
        startedAt,
      });

    return {
      attemptId: attempt.id,
      responseId: response ? response.id : null,
      formId: form.id,
      formVersionId: currentVersion.id,
      type: form.type,
      status: 'IN_PROGRESS',
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      externalUrl:
        form.type === 'EXTERNAL' ? currentVersion.externalUrl ?? null : null,
      storageCapability: createStorageCapability(
        process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters-long',
        attempt.id,
      ),
    };
  }

  /**
   * Idempotently records a batch of client behavioral telemetry events for a survey attempt (FR-58).
   * Verifies attempt ownership if authenticated and maps events to domain entities.
   */
  async recordTelemetryEvents(
    formId: string | null,
    attemptId: string,
    callerUserId: string | null,
    input: BatchTelemetryEventsInput,
  ): Promise<TelemetryIngestionResponseDto> {
    const attempt = await this.participationRepository.findAttemptById(attemptId);
    if (!attempt) {
      throw new SurveyNotAvailableException('Survey attempt not found.');
    }

    if (formId && attempt.surveyId !== formId) {
      throw new SurveyNotAvailableException('Survey attempt does not match the requested form.');
    }

    if (attempt.respondentId && callerUserId && attempt.respondentId !== callerUserId) {
      throw new ParticipantNotEligibleException('Unauthorized attempt access.');
    }

    const eventEntities = input.events.map(
      (e) =>
        new IntegrityEventEntity(
          e.clientEventId,
          e.eventType,
          attempt.id,
          attempt.formVersionId,
          attempt.respondentId,
          new Date(e.occurredAt),
          e.responseId ?? null,
          e.questionId ?? null,
          e.sequence ?? null,
          e.metadata ?? null,
        ),
    );

    const count = await this.participationRepository.saveIntegrityEvents(eventEntities);

    return {
      success: true,
      ingestedCount: count,
      attemptId: attempt.id,
    };
  }

  /**
   * Idempotently records telemetry events for an internal survey via responseId.
   */
  async recordResponseTelemetryEvents(
    responseId: string,
    callerUserId: string | null,
    input: BatchTelemetryEventsInput,
  ): Promise<TelemetryIngestionResponseDto> {
    const response = await this.participationRepository.findResponseById(responseId);
    if (!response) {
      throw new SurveyNotAvailableException('Survey response not found.');
    }

    if (!response.attemptId) {
      throw new SurveyNotAvailableException('Survey response has no associated attempt.');
    }

    return this.recordTelemetryEvents(
      response.formId,
      response.attemptId,
      callerUserId,
      input,
    );

  }
}
