import { randomBytes, randomUUID } from 'crypto';
import {
  ConflictingActiveAttemptDetails,
  FileAttachmentAnswer,
  RESERVATION_EXPIRY_MINUTES,
  RESERVATION_EXPIRY_MS,
  isSurveyTargetingMatch,
  parseStoredTargeting,
  StartSurveyAttemptInput,
  SurveyAttemptResponseDto,
  BatchTelemetryEventsInput,
  TelemetryIngestionResponseDto,
  InternalFormSubmissionInput,
  InternalFormSubmissionResponseDto,
  validateAnswersAgainstFormDefinition,
  parseFormDefinitionDraft,
  RewardSettlementResultDto,
  VerifyExternalCompletionCodeInput,
  VerifyExternalCompletionCodeResponseDto,
  ReportMissingCompletionCodeInput,
  ReportMissingCompletionCodeResponseDto,
  TimeBarrierRejectionDetails,
  computeInternalTimeBarrier,
  evaluateTimeBarrier,
  COMPLETION_CODE_POLICY,
  COMPLETION_CODE_POLICY_VERSION,
  CompletionCodeLimitResetRequest,
  CompletionCodeLimitResetResultDto,
} from '@rescom/schemas';
import { FormRepositoryPort } from '../../forms/application/ports/form-repository.port';
import { CompletionCodePort } from '../../forms/application/ports/completion-code.port';
import { DemographicProfileRepositoryPort } from '../../users/application/ports/demographic-profile.repository.port';
import { requireCompleteDemographicProfile } from '../../users/application/demographic-profile.gate';
import {
  CompletionLimitCheck,
  ParticipationRepositoryPort,
  SubmissionAttachment,
} from './ports/participation-repository.port';
import { IntegrityEventEntity } from '../domain/integrity-event.entity';
import {
  remainingCodeAttempts,
  SurveyAttemptEntity,
} from '../domain/survey-attempt.entity';
import { ResponseEntity } from '../domain/response.entity';
import { RewardSettlementCoordinator } from '../../economy/application/reward-settlement.coordinator';
import { StarterPointsCoordinator } from '../../economy/application/starter-points.coordinator';
import {
  ConflictingActiveAttemptException,
  ParticipantNotEligibleException,
  SelfParticipationForbiddenException,
  SurveyAlreadyCompletedException,
  SurveyNotAvailableException,
  SurveyQuotaFullException,
  ResponseNotFoundException,
  AttemptExpiredException,
  InvalidFormSubmissionException,
  SubmissionTooFastException,
  InvalidCompletionCodeException,
  AttemptLockedException,
  AttemptNotExternalException,
  CompletionCodeLimitReachedException,
  RewardNotSettleableException,
  SurveyRewardUnavailableException,
  TelemetryRejectedException,
} from './exceptions/participation.exceptions';
import { InsufficientBalanceException } from '../../economy/application/exceptions/economy.exceptions';
import {
  createStorageCapability,
  verifyStorageCapability,
} from '../../../common/security/storage-capability';
import {
  PassThroughUnitOfWork,
  UnitOfWorkPort,
} from '../../../common/database/unit-of-work.port';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import { SurveyQuotaClosePort } from './ports/survey-quota-close.port';
import {
  CompletionCapacityContext,
  ParticipationRateLimiter,
} from './participation-rate-limiter';
import {
  describeAttemptTimeBarrier,
  findPinnedVersion,
  ResolvedTimeBarrier,
  resolveTimeBarrier,
} from './attempt-projection';

/** Story 5.1 AC3.1; shared with Storage via `@rescom/schemas` (Epic 5 review P16). */
export { RESERVATION_EXPIRY_MINUTES };

/**
 * Epic 5 review P8: a finished attempt still accepts telemetry for this long
 * after its submission, so the final `SURVEY_SUBMITTED` flush lands.
 */
export const TELEMETRY_SUBMIT_GRACE_MS = 2 * 60 * 1000;

/** Epic 5 review P14: tolerated client clock skew of telemetry timestamps. */
export const TELEMETRY_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface ParticipationLogger {
  warn(message: string): void;
}

export interface ParticipationServiceOptions {
  /**
   * HMAC key of the guest storage capability (Epic 5 review P22):
   * `EnvService.storageCapabilitySecret`, which Storage verifies with. When
   * absent (unit tests) a random per-instance key is used — never a literal.
   */
  storageCapabilitySecret?: string;
  /**
   * Plan 2.3 (decision A): closes the survey (QUOTA) and refunds its leftover
   * Escrow in the transaction of the completion that meets its sample
   * target. Absent (unit tests) = surveys stay PUBLISHED when full.
   */
  quotaCloser?: SurveyQuotaClosePort;
}

/** Outcome of the locked completion-code unit (Epic 5 review P6). */
type ExternalVerificationOutcome =
  | { kind: 'REPLAY'; attempt: SurveyAttemptEntity }
  | { kind: 'LOCKED' }
  | { kind: 'EXPIRED' }
  | {
      kind: 'INVALID';
      failureCount: number;
      accountFailureCount: number;
      isLocked: boolean;
    }
  | { kind: 'LIMIT_REACHED'; failedVerifications: number }
  | { kind: 'RATE_LIMITED'; completionTimes: Date[] }
  | {
      kind: 'COMPLETED';
      attempt: SurveyAttemptEntity;
      rewardResult: RewardSettlementResultDto | null;
    };

type RewardPolicyMode = 'SHADOW' | 'ADVISORY' | 'ENFORCED';

/** Result of an Internal reward (re-)settlement from the pinned request. */
export interface InternalRewardRedriveResult {
  reward: RewardSettlementResultDto | null;
  policyMode: RewardPolicyMode;
}

export class ParticipationService {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly demographicRepository: DemographicProfileRepositoryPort,
    private readonly participationRepository: ParticipationRepositoryPort,
    private readonly rewardSettlementCoordinator?: RewardSettlementCoordinator,
    private readonly completionCodeService?: CompletionCodePort,
    private readonly starterPointsCoordinator?: StarterPointsCoordinator,
    private readonly unitOfWork: UnitOfWorkPort = new PassThroughUnitOfWork(),
    private readonly notificationPublisher?: NotificationPublisherPort,
    /** Story 8.2 (FR-46): per-user rate limits; absent = Time Barrier only. */
    private readonly rateLimiter?: ParticipationRateLimiter,
    private readonly logger?: ParticipationLogger,
    options: ParticipationServiceOptions = {},
  ) {
    this.storageCapabilitySecret =
      options.storageCapabilitySecret ?? randomBytes(32).toString('hex');
    this.quotaCloser = options.quotaCloser;
  }

  private readonly storageCapabilitySecret: string;
  private readonly quotaCloser?: SurveyQuotaClosePort;

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
    // Story 8.2: per-user request burst limit before any other work.
    if (userId) {
      await this.rateLimiter?.assertBurstAllowed(userId, 'ATTEMPT_START', {
        formId,
      });
    }

    // 0. Mandatory Demographic Survey gate (Story 7.1, FR-6): authenticated
    // participants cannot reach earning features before onboarding. Runs
    // before any lookup/reservation so the client always gets a routable code.
    const profileDto = userId
      ? await requireCompleteDemographicProfile(
          this.demographicRepository,
          userId,
        )
      : null;

    // 1. Verify exact Form and FormVersion are published/open
    const formWithVersion = await this.formRepository.findById(formId);
    if (!formWithVersion) {
      throw new SurveyNotAvailableException(
        `Survey with ID "${formId}" was not found.`,
      );
    }

    const { form, currentVersion } = formWithVersion;

    // Plan 2.3: a survey the system closed because its sample target was met
    // keeps the respondent-facing "survey full" answer.
    if (form.isClosed() && form.closeKind === 'QUOTA') {
      throw new SurveyQuotaFullException();
    }

    if (!form.isPublished() || !currentVersion.isPublished) {
      throw new SurveyNotAvailableException(
        `Survey "${formId}" is not published or currently active for participation.`,
      );
    }

    // Story IR.2b Task 9.2: no new start at or after the deadline (attempts
    // started before it may still finish; the deadline close waits for them).
    if (form.deadlineAt && form.deadlineAt.getTime() <= Date.now()) {
      throw new SurveyNotAvailableException(
        `Survey "${formId}" is past its collection deadline.`,
      );
    }

    // 1b. Decision E4-DN2 (option A): a Publisher never takes their own
    // survey (no self-payment from their own Escrow, no self-selected
    // sample); the Marketplace feed hides it as well.
    if (userId && form.isOwnedBy(userId)) {
      throw new SelfParticipationForbiddenException();
    }

    // 2. Verify targeting eligibility for authenticated participants
    if (userId) {
      // Malformed stored targeting fails closed (not eligible).
      const parsedTargeting = parseStoredTargeting(
        currentVersion.targetingJson,
      );
      if (
        !parsedTargeting.ok ||
        !isSurveyTargetingMatch(parsedTargeting.targeting, profileDto)
      ) {
        throw new ParticipantNotEligibleException();
      }
    }

    // 3-5. Cheap pre-checks with today's definitions. The authoritative
    // checks run again inside `reserveAttempt`, under the form row lock and in
    // the same transaction as the insert (Epic 5 review P1, AD-19).
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - RESERVATION_EXPIRY_MS);

    if (userId) {
      // One completion per authenticated account at logical Form level (FR-25).
      const hasCompleted =
        await this.participationRepository.hasCompletedLogicalForm(
          userId,
          form.id,
        );
      if (hasCompleted) {
        throw new SurveyAlreadyCompletedException();
      }

      // An unexpired active attempt of this account (expired ones are
      // abandoned inside the reservation transaction).
      const activeAttempt =
        await this.participationRepository.findConflictingActiveAttempt(
          userId,
          form.id,
          cutoffDate,
        );
      if (activeAttempt) {
        throw await this.conflictingAttemptError(
          activeAttempt,
          userId,
          form.id,
          form.type,
          cutoffDate,
        );
      }

      // Decision E5-D1 (`completion-code-policy-v1`): an account that used
      // every completion-code try on this External version gets no new
      // attempt on it (no fresh guesses at the shared per-version code).
      if (form.type === 'EXTERNAL') {
        const failedVerifications =
          await this.participationRepository.countCompletionCodeFailures(
            userId,
            currentVersion.id,
          );
        if (
          failedVerifications >=
          COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion
        ) {
          throw this.completionCodeLimitError(
            currentVersion.id,
            failedVerifications,
          );
        }
      }

      // Story 8.2 (FR-46) + decision E8-D6: the completion limit blocks
      // further attempts temporarily, reserving capacity at start —
      // completions in the window plus the user's open attempts; counted
      // from PostgreSQL (authoritative) and re-checked under the user's lock
      // in the reservation transaction.
      await this.rateLimiter?.assertStartCapacity(userId, {
        action: 'ATTEMPT_START',
        formId: form.id,
      });
    }

    // Quota: completed participations + active reservations < expectedCompletions
    const { completedCount, activeReservationCount } =
      await this.participationRepository.getQuotaStatus(form.id, cutoffDate);
    if (completedCount + activeReservationCount >= form.expectedCompletions) {
      throw new SurveyQuotaFullException();
    }

    // 6. Atomic reservation: re-check + Attempt + (if INTERNAL) durable
    // Response identity, serialized per form (Epic 5 review P1).
    const attemptId = randomUUID();
    const startedAt = now;
    const expiresAt = new Date(startedAt.getTime() + RESERVATION_EXPIRY_MS);

    const isGuest = !userId;
    const completionReservation = this.completionLimitFor(userId);
    const reservation = await this.participationRepository.reserveAttempt({
      attemptId,
      formId: form.id,
      formVersionId: currentVersion.id,
      respondentId: userId,
      isGuest,
      formType: form.type,
      clientContext: input.clientContext,
      ipAddress: clientIp,
      startedAt,
      expectedCompletions: form.expectedCompletions,
      cutoffDate,
      ...(completionReservation ? { completionReservation } : {}),
      ...(userId && form.type === 'EXTERNAL'
        ? {
            completionCodeFailureLimit:
              COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion,
          }
        : {}),
    });

    switch (reservation.outcome) {
      case 'NOT_OPEN':
        throw new SurveyNotAvailableException(
          `Survey "${formId}" is not published or currently active for participation.`,
        );
      case 'ALREADY_COMPLETED':
        throw new SurveyAlreadyCompletedException();
      case 'CONFLICTING_ACTIVE':
        throw await this.conflictingAttemptError(
          reservation.attempt,
          userId,
          form.id,
          form.type,
          cutoffDate,
        );
      case 'QUOTA_FULL':
        throw new SurveyQuotaFullException();
      case 'COMPLETION_CODE_LIMIT_REACHED':
        throw this.completionCodeLimitError(
          currentVersion.id,
          reservation.failedVerifications,
        );
      case 'RATE_LIMITED':
        // Decision E8-D6: a parallel start or completion of this user took
        // the last reserved slot after the pre-check; nothing was written.
        if (!this.rateLimiter || !completionReservation) {
          throw new Error('Start reservation outcome without a rate limiter.');
        }
        return this.rateLimiter.rejectStartCapacity(
          completionReservation.userId,
          reservation.completionTimes,
          reservation.openAttemptStartTimes,
          { action: 'ATTEMPT_START', formId: form.id },
          completionReservation.now,
        );
      case 'CREATED':
        break;
    }
    const { attempt, response } = reservation;

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
        form.type === 'EXTERNAL' ? (currentVersion.externalUrl ?? null) : null,
      storageCapability: createStorageCapability(
        this.storageCapabilitySecret,
        attempt.id,
      ),
      timeBarrier: describeAttemptTimeBarrier(
        resolveTimeBarrier(form.type, currentVersion),
        startedAt,
      ),
    };
  }

  /** Decision E5-D1: 409 COMPLETION_CODE_LIMIT_REACHED for one version. */
  private completionCodeLimitError(
    formVersionId: string,
    failedVerifications: number,
  ): CompletionCodeLimitReachedException {
    return new CompletionCodeLimitReachedException({
      formVersionId,
      failedVerifications,
      limit: COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion,
      policyVersion: COMPLETION_CODE_POLICY_VERSION,
    });
  }

  /**
   * Epic 5 review P24: a 409 CONFLICTING_ACTIVE_ATTEMPT that tells the
   * caller which of ITS OWN attempts is active, so a client that lost its tab
   * can resume it instead of waiting up to 30 minutes.
   */
  private async conflictingAttemptError(
    knownAttempt: SurveyAttemptEntity | null,
    userId: string | null,
    formId: string,
    formType: 'INTERNAL' | 'EXTERNAL',
    cutoffDate: Date,
  ): Promise<ConflictingActiveAttemptException> {
    const active =
      knownAttempt ??
      (userId
        ? await this.participationRepository.findConflictingActiveAttempt(
            userId,
            formId,
            cutoffDate,
          )
        : null);
    if (!active || !userId || active.respondentId !== userId) {
      return new ConflictingActiveAttemptException();
    }
    const response =
      formType === 'INTERNAL'
        ? await this.participationRepository.findResponseByAttemptId(active.id)
        : null;
    const details: ConflictingActiveAttemptDetails = {
      attemptId: active.id,
      responseId: response?.id ?? null,
      formVersionId: active.formVersionId,
      type: formType,
      expiresAt: new Date(
        active.startedAt.getTime() + RESERVATION_EXPIRY_MS,
      ).toISOString(),
    };
    return new ConflictingActiveAttemptException(undefined, details);
  }

  /**
   * Idempotently records a batch of client behavioral telemetry events for a survey attempt (FR-58).
   * Epic 5 review P8/P14: only the attempt's owner (its account, or the
   * guest holding the attempt capability) may write; only Internal attempts
   * collect telemetry; only while the attempt is open (or just submitted);
   * every event must belong to this attempt and carry a plausible timestamp.
   */
  async recordTelemetryEvents(
    formId: string | null,
    attemptId: string,
    callerUserId: string | null,
    input: BatchTelemetryEventsInput,
    ownerCapability?: string | null,
    knownResponse?: ResponseEntity,
  ): Promise<TelemetryIngestionResponseDto> {
    const attempt =
      await this.participationRepository.findAttemptById(attemptId);
    if (!attempt) {
      throw new SurveyNotAvailableException('Survey attempt not found.');
    }

    if (formId && attempt.surveyId !== formId) {
      throw new SurveyNotAvailableException(
        'Survey attempt does not match the requested form.',
      );
    }

    // 1. Ownership: an account's attempt needs that account's session; a
    // guest attempt needs its capability.
    if (attempt.respondentId) {
      if (callerUserId !== attempt.respondentId) {
        throw new ParticipantNotEligibleException(
          'Unauthorized attempt access.',
        );
      }
    } else if (
      !verifyStorageCapability(
        this.storageCapabilitySecret,
        attempt.id,
        ownerCapability,
      )
    ) {
      throw new ParticipantNotEligibleException('Unauthorized attempt access.');
    }

    // 2. FR-58: External forms do not use integrity telemetry.
    const response =
      knownResponse ??
      (await this.participationRepository.findResponseByAttemptId(attempt.id));
    if (!response) {
      throw new TelemetryRejectedException(
        'Integrity telemetry is only collected for internal surveys.',
      );
    }

    // 3. Only while the attempt is open, or just after its submission.
    const now = new Date();
    const isOpen =
      attempt.status === 'IN_PROGRESS' &&
      now.getTime() - attempt.startedAt.getTime() <= RESERVATION_EXPIRY_MS;
    const isJustSubmitted =
      attempt.status === 'COMPLETED' &&
      attempt.submittedAt !== null &&
      now.getTime() - attempt.submittedAt.getTime() <=
        TELEMETRY_SUBMIT_GRACE_MS;
    if (!isOpen && !isJustSubmitted) {
      throw new AttemptExpiredException(
        'Telemetry is no longer accepted for this survey attempt.',
      );
    }

    // 4. Every event must describe this attempt, at a plausible time.
    const earliest = attempt.startedAt.getTime() - TELEMETRY_CLOCK_SKEW_MS;
    const latest = now.getTime() + TELEMETRY_CLOCK_SKEW_MS;
    for (const event of input.events) {
      if (
        event.attemptId !== attempt.id ||
        event.formVersionId !== attempt.formVersionId ||
        (event.responseId != null && event.responseId !== response.id)
      ) {
        throw new TelemetryRejectedException(
          'Telemetry events must belong to this survey attempt.',
        );
      }
      const occurredAt = Date.parse(event.occurredAt);
      if (occurredAt < earliest || occurredAt > latest) {
        throw new TelemetryRejectedException(
          "Telemetry event time is outside the survey attempt's lifetime.",
        );
      }
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

    const count =
      await this.participationRepository.saveIntegrityEvents(eventEntities);

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
    ownerCapability?: string | null,
  ): Promise<TelemetryIngestionResponseDto> {
    const response =
      await this.participationRepository.findResponseById(responseId);
    if (!response) {
      throw new SurveyNotAvailableException('Survey response not found.');
    }

    if (!response.attemptId) {
      throw new SurveyNotAvailableException(
        'Survey response has no associated attempt.',
      );
    }

    return this.recordTelemetryEvents(
      response.formId,
      response.attemptId,
      callerUserId,
      input,
      ownerCapability,
      response,
    );
  }

  /**
   * Submits and validates an internal survey response (FR-40, FR-29, AD-10, AD-19).
   * Validates answers against immutable FormVersion definition, verifies time barrier,
   * performs atomic status transition and AD-10 outbox event persistence,
   * and settles respondent rewards (instant in SHADOW/ADVISORY, hold in ENFORCED, skip for guest).
   */
  async submitInternalResponse(
    responseOrFormId: string,
    callerUserId: string | null,
    input: InternalFormSubmissionInput,
    isResponseEndpoint = true,
  ): Promise<InternalFormSubmissionResponseDto> {
    // Story 8.2: per-user request burst limit before any other work.
    if (callerUserId) {
      await this.rateLimiter?.assertBurstAllowed(
        callerUserId,
        'INTERNAL_SUBMISSION',
        isResponseEndpoint
          ? { responseId: responseOrFormId }
          : {
              formId: responseOrFormId,
              responseId: input.responseId,
              attemptId: input.attemptId,
            },
      );
    }

    // 1. Resolve Response and SurveyAttempt
    const response = isResponseEndpoint
      ? await this.participationRepository.findResponseById(responseOrFormId)
      : input.responseId
        ? await this.participationRepository.findResponseById(input.responseId)
        : input.attemptId
          ? await this.participationRepository.findResponseByAttemptId(
              input.attemptId,
            )
          : null;

    if (!response) {
      throw new ResponseNotFoundException(
        `Survey response not found for ID "${responseOrFormId}".`,
      );
    }

    if (!isResponseEndpoint && response.formId !== responseOrFormId) {
      throw new SurveyNotAvailableException(
        `Response does not match form "${responseOrFormId}".`,
      );
    }

    // Epic 5 review P7: identifiers given together must belong together.
    if (
      (input.attemptId && response.attemptId !== input.attemptId) ||
      (isResponseEndpoint &&
        input.responseId &&
        input.responseId !== response.id)
    ) {
      throw new InvalidFormSubmissionException(
        'The response and attempt identifiers do not belong together.',
        { attemptId: 'Does not match the survey response' },
      );
    }

    if (!response.attemptId) {
      throw new SurveyNotAvailableException(
        `Response has no associated survey attempt.`,
      );
    }

    const attempt = await this.participationRepository.findAttemptById(
      response.attemptId,
    );
    if (!attempt) {
      throw new SurveyNotAvailableException(
        `Associated survey attempt not found.`,
      );
    }

    // 2. Authorization checks
    if (callerUserId) {
      if (response.respondentId && response.respondentId !== callerUserId) {
        throw new ParticipantNotEligibleException(
          'Unauthorized response submission.',
        );
      }
    } else {
      if (!response.isGuest) {
        throw new ParticipantNotEligibleException(
          'Authentication required to submit this response.',
        );
      }
    }

    // 3. Fast-path Idempotency & Completion check. An authenticated owner's
    // replay also re-drives a settlement that failed after the submission
    // committed (Epic 6 review P5), from the pinned reward request.
    const now = new Date();
    if (response.status === 'VALIDATED' || response.status === 'SUBMITTED') {
      return this.replayInternalSubmission(response, attempt, callerUserId);
    }
    // Epic 5 review P7 (defence in depth): a response under review is never
    // re-submitted. Unreachable until Story 8.5 writes these statuses.
    if (response.status === 'DISPUTED' || response.status === 'REJECTED') {
      throw new SurveyAlreadyCompletedException(
        'This survey response was already submitted and is under review.',
      );
    }

    // 4. Attempt status & expiration check
    if (attempt.status !== 'IN_PROGRESS') {
      throw new AttemptExpiredException(
        attempt.status === 'ABANDONED'
          ? 'Survey attempt was abandoned and can no longer be submitted.'
          : 'Survey attempt can no longer be submitted.',
      );
    }

    const expiryTime = new Date(
      attempt.startedAt.getTime() + RESERVATION_EXPIRY_MS,
    );
    if (now > expiryTime) {
      throw new AttemptExpiredException(
        'Survey attempt reservation has expired. Please start a new attempt.',
      );
    }

    // 5. Fetch Form & the attempt's PINNED immutable FormVersion (AD-19)
    const formWithVersion = await this.formRepository.findById(response.formId);
    if (!formWithVersion) {
      throw new SurveyNotAvailableException('Survey not found.');
    }
    const { form } = formWithVersion;
    const pinnedVersion = findPinnedVersion(
      formWithVersion,
      attempt.formVersionId,
    );
    if (!form.isPublished() || !pinnedVersion?.isPublished) {
      throw new SurveyNotAvailableException(
        'Survey is not published or active for submissions.',
      );
    }

    const parsedForm = parseFormDefinitionDraft(pinnedVersion.schemaJson);
    if (!parsedForm.success) {
      throw new SurveyNotAvailableException(
        'Survey definition schema is invalid or corrupted.',
      );
    }
    const { blocks } = parsedForm.data;

    // 6. Time Barrier (FR-45, FR-28, Story 8.2): answerable questions x 2 s or
    // the publisher minimum, measured from the server-recorded attempt start
    // only. Checked before answer validation so a fast script with junk
    // answers still leaves evidence. Nothing is consumed on rejection.
    const barrier = computeInternalTimeBarrier(parsedForm.data);
    const timing = evaluateTimeBarrier({
      startedAt: attempt.startedAt,
      now,
      requiredSeconds: barrier.requiredSeconds,
    });
    if (!timing.passed) {
      await this.rejectTooFast(
        response.isGuest ? null : response.respondentId,
        { ...barrier },
        timing,
        {
          source: 'INTERNAL_SUBMISSION',
          attemptId: attempt.id,
          responseId: response.id,
          formId: form.id,
          formVersionId: pinnedVersion.id,
        },
      );
    }

    // 7. Strict Answer Validation against the pinned block definitions (FR-40)
    const validationOutcome = validateAnswersAgainstFormDefinition(
      blocks,
      input.answers,
    );
    if (!validationOutcome.isValid) {
      throw new InvalidFormSubmissionException(
        'Form submission contains invalid or missing answers.',
        validationOutcome.errors,
      );
    }

    // 7b. Completion rate limit (FR-46, Story 8.2). Decision E8-D6: the
    // capacity was reserved when this attempt started, so there is no
    // pre-check here (an honest respondent never loses finished work to a
    // 429). The transaction keeps the Epic 8 review P3 backstop under the
    // user's lock; it counts completed attempts only, so this attempt's own
    // reservation is never counted twice.
    const completionContext: CompletionCapacityContext = {
      action: 'INTERNAL_SUBMISSION',
      formId: form.id,
      attemptId: attempt.id,
    };
    const completionLimit = this.completionLimitFor(
      response.isGuest ? null : response.respondentId,
    );

    // 8. Every attached file, with the question it answers (Epic 5 review
    // P3/P4). The strict validator already normalized each file answer to a
    // list of FileAttachmentAnswer; one object may answer one question once.
    const attachments: SubmissionAttachment[] = [];
    const seenObjectIds = new Set<string>();
    for (const block of blocks) {
      if (block.type !== 'file_upload') continue;
      const files = validationOutcome.normalizedAnswers[block.id];
      if (!Array.isArray(files)) continue;
      for (const file of files as FileAttachmentAnswer[]) {
        if (seenObjectIds.has(file.objectId)) {
          throw new InvalidFormSubmissionException(
            'Each uploaded file may be referenced only once.',
            { [block.id]: 'Duplicate file reference' },
          );
        }
        seenObjectIds.add(file.objectId);
        attachments.push({ objectId: file.objectId, questionId: block.id });
      }
    }

    // 9. Resolve effective ScoringPolicy deployment
    const activeDeployment =
      await this.participationRepository.findActivePolicyDeployment();
    const policyMode = activeDeployment?.status ?? 'SHADOW';
    const policyDeploymentId = activeDeployment?.id ?? 'policy-default-v1';

    // 10. Atomic database transaction (Response VALIDATED + Attempt COMPLETED + Outbox events)
    const txResult =
      await this.participationRepository.submitInternalResponseTransaction({
        responseId: response.id,
        attemptId: attempt.id,
        formId: form.id,
        formVersionId: pinnedVersion.id,
        respondentId: response.respondentId,
        isGuest: response.isGuest,
        answers: validationOutcome.normalizedAnswers,
        submittedAt: now,
        policyMode,
        policyDeploymentId,
        // The advertised reward, credited in full; Escrow pays the reserved
        // 80% and the platform the rest (decision E6-D1).
        rewardAmount: form.rewardPerResponse,
        publisherId: form.publisherId,
        attachments,
        // Hard-control evidence for the (Phase-2) Research Integrity Engine.
        securityEvidence: {
          timeBarrier: {
            policyVersion: barrier.policyVersion,
            requiredSeconds: barrier.requiredSeconds,
            elapsedSeconds: timing.elapsedSeconds,
            questionCount: barrier.questionCount,
          },
        },
        ...(completionLimit ? { completionLimit } : {}),
        // Plan 2.3: the submission that meets the sample target closes the
        // survey (QUOTA) and refunds its leftover Escrow in its transaction.
        ...(this.quotaCloser
          ? {
              afterCompletion: async () => {
                await this.quotaCloser?.closeFormIfQuotaMet(form.id, now);
              },
            }
          : {}),
      });

    // Epic 5 review P7: the transaction is state-predicated; only this
    // call's own commit continues to settlement.
    switch (txResult.outcome) {
      case 'RATE_LIMITED':
        // Epic 8 review P3 backstop (only when the start reservation was
        // bypassed, e.g. a legacy attempt): nothing was written, the attempt
        // stays IN_PROGRESS.
        return this.rejectRacedCompletion(
          completionLimit,
          txResult.completionTimes,
          completionContext,
        );
      case 'ALREADY_SUBMITTED': {
        // A concurrent (or earlier) submit won: return its original result.
        const committed =
          (await this.participationRepository.findResponseById(response.id)) ??
          response;
        return this.replayInternalSubmission(committed, attempt, callerUserId);
      }
      case 'NOT_SUBMITTABLE':
        throw new AttemptExpiredException(
          'Survey attempt can no longer be submitted.',
        );
      case 'ALREADY_COMPLETED_LOGICAL':
        throw new SurveyAlreadyCompletedException();
      case 'FORM_NOT_OPEN':
        throw new SurveyNotAvailableException(
          'Survey is not published or active for submissions.',
        );
      case 'SUBMITTED':
        break;
    }

    // 11. Settle reward via RewardSettlementCoordinator (FR-29, AD-16). The
    // submission already committed, so a settlement failure never fails the
    // request: the reward stays pending settlement and is re-driven by the
    // respondent's replay or the Admin re-drive (Epic 6 review P5). The
    // coordinator announces an instant credit once it commits (REWARD_EARNED,
    // decision E9-D2), on whichever of these paths posts it.
    let rewardResult: RewardSettlementResultDto | null = null;
    if (this.rewardSettlementCoordinator) {
      try {
        rewardResult =
          await this.rewardSettlementCoordinator.settleInternalReward({
            responseId: response.id,
            publisherId: form.publisherId,
            respondentId: response.respondentId,
            rewardPerResponse: form.rewardPerResponse,
            policyMode,
          });
      } catch (error) {
        this.logger?.warn(
          `Internal reward settlement for response ${response.id} failed after the submission committed; it stays pending settlement (${errorName(error)}).`,
        );
      }
    }

    // Story 7.2 (FR-8): the activation unlock runs after the submission
    // committed and never fails it; a failure is retried by a later trigger.
    if (response.respondentId && this.starterPointsCoordinator) {
      await this.starterPointsCoordinator.tryUnlockStarterPoints(
        response.respondentId,
        'INTERNAL_SUBMISSION',
      );
    }

    return {
      responseId: txResult.response.id,
      attemptId: txResult.attempt.id,
      formId: form.id,
      formVersionId: pinnedVersion.id,
      status: 'VALIDATED',
      submittedAt: now.toISOString(),
      reward: rewardResult,
      policyMode,
    };
  }

  /**
   * The original result of an already-submitted Internal response (AD-16):
   * decision E5-D3 (2026-09-26, option A) — a resubmission is an idempotent
   * 200 with the original response id, submission time, reward and policy
   * mode (Story 5.4 AC2.1/AC6.2 amended); 409 stays for ABANDONED, expired
   * and LOCKED attempts. An authenticated owner's replay also re-drives a
   * settlement that failed after the submission committed (Epic 6 review P5)
   * and re-checks the starter unlock (Epic 7 review P5).
   */
  private async replayInternalSubmission(
    response: ResponseEntity,
    attempt: SurveyAttemptEntity,
    callerUserId: string | null,
  ): Promise<InternalFormSubmissionResponseDto> {
    const ownerId =
      callerUserId && !response.isGuest ? response.respondentId : null;
    const replay = ownerId
      ? await this.redriveInternalRewardSafely(response.id)
      : { reward: null, policyMode: 'SHADOW' as const };

    // Epic 7 review P5 (Story 7.2 AC6): a later trigger retries an unlock that
    // failed after the first submission. Non-fatal and idempotent (an active
    // account only re-publishes the deduplicated notice).
    if (ownerId && this.starterPointsCoordinator) {
      await this.starterPointsCoordinator.tryUnlockStarterPoints(
        ownerId,
        'INTERNAL_SUBMISSION',
      );
    }

    return {
      responseId: response.id,
      attemptId: attempt.id,
      formId: response.formId,
      formVersionId: response.formVersionId,
      status: 'VALIDATED',
      submittedAt: (response.submittedAt ?? new Date()).toISOString(),
      reward: replay.reward,
      policyMode: replay.policyMode,
    };
  }

  /**
   * Verifies a 6-digit completion code for an external survey attempt (FR-13, FR-22, FR-24, AD-16).
   * Enforces server-authoritative time barrier, constant-time HMAC check against pinned FormVersion,
   * locks attempt after 3 failed attempts, and atomically settles pending reward into Economy.
   */
  async verifyExternalCompletionCode(
    formId: string | null,
    attemptId: string,
    callerUserId: string,
    input: VerifyExternalCompletionCodeInput,
  ): Promise<VerifyExternalCompletionCodeResponseDto> {
    // Story 8.2: per-user request burst limit before any other work.
    await this.rateLimiter?.assertBurstAllowed(
      callerUserId,
      'COMPLETION_CODE',
      {
        formId,
        attemptId,
      },
    );

    const attempt =
      await this.participationRepository.findAttemptById(attemptId);
    if (!attempt) {
      throw new SurveyNotAvailableException('Survey attempt not found.');
    }

    if (formId && attempt.surveyId !== formId) {
      throw new SurveyNotAvailableException(
        'Survey attempt does not match the requested form.',
      );
    }

    if (attempt.respondentId !== callerUserId) {
      throw new ParticipantNotEligibleException('Unauthorized attempt access.');
    }

    const formWithVersion = await this.formRepository.findById(
      attempt.surveyId,
    );
    if (!formWithVersion) {
      throw new SurveyNotAvailableException('Survey not found.');
    }
    const { form, currentVersion } = formWithVersion;
    if (form.type !== 'EXTERNAL') {
      throw new AttemptNotExternalException(
        'Survey attempt is not for an external survey.',
      );
    }

    const pinnedVersion =
      formWithVersion.versions?.find((v) => v.id === attempt.formVersionId) ||
      (currentVersion.id === attempt.formVersionId ? currentVersion : null);
    if (!pinnedVersion) {
      throw new SurveyNotAvailableException('Pinned survey version not found.');
    }
    // Bug 3.4: a completion-code rotation after this attempt started creates
    // a newer published version with a new code. The code is verified against
    // that newest code only (a superseded code is rejected) and the failure
    // budget is keyed by it. BE-7 (decision D4): a wrong code or the claim
    // re-pins the attempt to that version, so its strikes count toward the
    // budget they are checked against; a retry then finds it pinned there.
    const verifyVersion =
      currentVersion.id !== pinnedVersion.id &&
      currentVersion.formId === form.id &&
      currentVersion.isPublished &&
      currentVersion.versionNumber > pinnedVersion.versionNumber
        ? currentVersion
        : pinnedVersion;

    const now = new Date();

    // 1. Fast-path Idempotency check (AD-16: retry returns the original
    // result, read from the posted journal — never re-priced, Epic 5 P19).
    if (attempt.status === 'COMPLETED') {
      return this.replayExternalCompletion(attempt, form.id, callerUserId);
    }

    // 2. Locked status check (3 failed validations lock attempt per FR-22).
    // Every locked reply carries the same body (Epic 5 review P6).
    if (attempt.status === 'LOCKED') {
      throw new AttemptLockedException();
    }

    // 3. Expiration and abandoned checks
    if (attempt.status === 'ABANDONED') {
      throw new AttemptExpiredException(
        'Survey attempt was abandoned and can no longer be completed.',
      );
    }

    const expiryTime = new Date(
      attempt.startedAt.getTime() + RESERVATION_EXPIRY_MS,
    );
    if (now > expiryTime) {
      throw new AttemptExpiredException(
        'Survey attempt reservation has expired. Please start a new attempt.',
      );
    }

    // 3b. A closed (or unpublished) survey takes no new completions, like
    // the Internal submit: its Escrow may already be refunded (Epic 6 review
    // P6). Checked before the code so no try is burned.
    if (!form.isPublished() || !pinnedVersion.isPublished) {
      throw new SurveyNotAvailableException(
        'Survey is not published or active for completions.',
      );
    }

    // 4. Server-authoritative Time Barrier Verification (FR-13, FR-22, FR-45).
    // External forms have no question count: publisher minimum or 15 s.
    const barrier = resolveTimeBarrier('EXTERNAL', pinnedVersion);
    const timing = evaluateTimeBarrier({
      startedAt: attempt.startedAt,
      now,
      requiredSeconds: barrier.requiredSeconds,
    });
    if (!timing.passed) {
      await this.rejectTooFast(callerUserId, barrier, timing, {
        source: 'EXTERNAL_COMPLETION_CODE',
        attemptId: attempt.id,
        formId: form.id,
        formVersionId: pinnedVersion.id,
      });
    }

    // 4b. Completion rate limit (FR-46, Story 8.2). Decision E8-D6: the
    // capacity was reserved when this attempt started, so there is no
    // pre-check here. The claim keeps the Epic 8 review P3 backstop under
    // the user's lock (after a valid code, so it never burns a try).
    const completionContext: CompletionCapacityContext = {
      action: 'COMPLETION_CODE',
      formId: form.id,
      attemptId: attempt.id,
    };
    const completionLimit = this.completionLimitFor(callerUserId);

    // 4c. Epic 5 review P9: a survey version whose verifier cannot be checked
    // (missing, legacy or unknown key version) is the platform's problem, not
    // the respondent's: no strike, no FraudLog entry.
    const completionCodeService = this.completionCodeService;
    if (
      !completionCodeService ||
      !completionCodeService.canVerify(verifyVersion.completionCode)
    ) {
      this.logger?.warn(
        `Completion code verification is unavailable for form version ${verifyVersion.id} (missing or unusable verifier); no strike was recorded.`,
      );
      throw new SurveyNotAvailableException(
        'Completion code verification is unavailable for this survey version.',
      );
    }

    // 5-6. Epic 5 review P6: status check, constant-time comparison and the
    // strike or the claim form ONE unit under the attempt row lock, so
    // parallel guesses are serialized and can never exceed 3 strikes. The
    // valid path claims the attempt and posts the Economy Pending journal in
    // the same Unit of Work (AD-16, FR-24). A strike commits with the unit
    // and is only then reported (never rolled back by the error). With the
    // FR-46 limit, the unit first takes the user's completion lock (Epic 8
    // review P3): user lock -> form row -> attempt row, like the submit.
    const outcome: ExternalVerificationOutcome = await this.unitOfWork.run(
      `external-completion:${attempt.id}`,
      async (): Promise<ExternalVerificationOutcome> => {
        const locked =
          await this.participationRepository.lockAttemptForVerification(
            attempt.id,
            form.id,
            completionLimit?.userId,
          );
        if (!locked) {
          return { kind: 'EXPIRED' };
        }
        if (locked.status === 'COMPLETED') {
          return { kind: 'REPLAY', attempt: locked };
        }
        if (locked.status === 'LOCKED') {
          return { kind: 'LOCKED' };
        }
        if (locked.status !== 'IN_PROGRESS') {
          return { kind: 'EXPIRED' };
        }

        // Decision E5-D1: the account+version budget, under the attempt lock
        // and before the code is compared (so it never leaks a correct code).
        const accountFailures =
          await this.participationRepository.countCompletionCodeFailures(
            callerUserId,
            verifyVersion.id,
          );
        if (
          accountFailures >= COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion
        ) {
          return {
            kind: 'LIMIT_REACHED',
            failedVerifications: accountFailures,
          };
        }

        // Keyed verifier, constant-time (FR-22). The plaintext code is never logged.
        const isCodeValid = completionCodeService.verifyCode(
          verifyVersion.id,
          input.completionCode,
          verifyVersion.completionCode,
        );
        if (!isCodeValid) {
          const {
            failureCount,
            isLocked,
            accountFailureCount,
            attemptInProgress,
          } =
            await this.participationRepository.recordFailedAttemptVerification(
              attempt.id,
              callerUserId,
              verifyVersion.id,
            );
          // Review LOW-2: an attempt that left IN_PROGRESS under the lock
          // (cancelled or expired) took no strike and can no longer be
          // completed: 409 ATTEMPT_EXPIRED, not a wrong-code reply.
          if (!attemptInProgress && !isLocked) {
            return { kind: 'EXPIRED' };
          }
          return {
            kind: 'INVALID',
            failureCount,
            accountFailureCount,
            isLocked,
          };
        }

        const claim =
          await this.participationRepository.completeExternalAttemptTransaction(
            {
              attemptId: attempt.id,
              respondentId: callerUserId,
              formId: form.id,
              formVersionId: verifyVersion.id,
              submittedAt: now,
              ...(completionLimit ? { completionLimit } : {}),
            },
          );
        switch (claim.outcome) {
          case 'RATE_LIMITED':
            // Epic 8 review P3: a parallel completion took the last slot.
            // The code was valid, so no strike; nothing was written. The
            // evidence and the 429 follow after the Unit of Work ended.
            return {
              kind: 'RATE_LIMITED',
              completionTimes: claim.completionTimes,
            };
          case 'FORM_NOT_OPEN':
            // The survey closed while this completion was in flight (the form
            // row lock serializes it with the close, Epic 6 review P6).
            throw new SurveyNotAvailableException(
              'Survey is not published or active for completions.',
            );
          case 'ALREADY_COMPLETED_LOGICAL':
            throw new SurveyAlreadyCompletedException();
          case 'ALREADY_COMPLETED':
            return { kind: 'REPLAY', attempt: claim.attempt };
          case 'NOT_CLAIMABLE':
            return claim.attempt.status === 'LOCKED'
              ? { kind: 'LOCKED' }
              : { kind: 'EXPIRED' };
          case 'COMPLETED':
            break;
        }

        const rewardResult = this.rewardSettlementCoordinator
          ? await this.settleExternalOrExisting(
              attempt.id,
              form.publisherId,
              callerUserId,
              form.rewardPerResponse,
            )
          : null;
        // Plan 2.3: the verification that meets the sample target closes the
        // survey (QUOTA) and refunds its leftover Escrow in this Unit of Work
        // (after this completion's own Pending credit drew its Escrow).
        await this.quotaCloser?.closeFormIfQuotaMet(form.id, now);
        return { kind: 'COMPLETED', attempt: claim.attempt, rewardResult };
      },
    );

    switch (outcome.kind) {
      case 'RATE_LIMITED':
        return this.rejectRacedCompletion(
          completionLimit,
          outcome.completionTimes,
          completionContext,
        );
      case 'REPLAY':
        return this.replayExternalCompletion(
          outcome.attempt,
          form.id,
          callerUserId,
        );
      case 'LOCKED':
        throw new AttemptLockedException();
      case 'LIMIT_REACHED':
        throw this.completionCodeLimitError(
          verifyVersion.id,
          outcome.failedVerifications,
        );
      case 'EXPIRED':
        throw new AttemptExpiredException(
          'Survey attempt can no longer be completed.',
        );
      case 'INVALID':
        if (outcome.isLocked) {
          throw new AttemptLockedException();
        }
        throw new InvalidCompletionCodeException(
          remainingCodeAttempts(
            outcome.failureCount,
            outcome.accountFailureCount,
          ),
        );
      case 'COMPLETED':
        break;
    }

    const { rewardResult } = outcome;
    const completedAt = outcome.attempt.submittedAt ?? now;

    // Only after the completion Unit of Work committed.
    await this.notifyPendingCredit(callerUserId, attempt.id, rewardResult);

    // Story 7.2: an External completion activates the account only after its
    // 48-hour review window; this non-fatal check still unlocks when another
    // qualifying survey already exists.
    if (this.starterPointsCoordinator) {
      await this.starterPointsCoordinator.tryUnlockStarterPoints(
        callerUserId,
        'EXTERNAL_VERIFICATION',
      );
    }

    const reward = rewardResult ?? {
      status: 'PENDING' as const,
      journalId: null,
      amount: form.rewardPerResponse,
      targetAccountClass: 'PENDING' as const,
      settledAt: completedAt.toISOString(),
    };
    return {
      attemptId: attempt.id,
      formId: form.id,
      formVersionId: verifyVersion.id,
      status: 'COMPLETED',
      completedAt: completedAt.toISOString(),
      reward,
      message: `Completion code verified successfully! +${reward.amount} points credited to Pending balance (48-hour dispute window).`,
    };
  }

  /**
   * Epic 5 review P19: the original result of an already-verified External
   * attempt, read from its posted Pending journal (`external-completion:
   * {attemptId}`). It never posts and never uses the form's current price;
   * a completion without a journal (reward 0) replays as amount 0. A missing
   * journal is recovered only through the Admin re-drive (Epic 6 review P1).
   */
  private async replayExternalCompletion(
    attempt: SurveyAttemptEntity,
    formId: string,
    callerUserId: string,
  ): Promise<VerifyExternalCompletionCodeResponseDto> {
    const completedAt = attempt.submittedAt ?? new Date();
    const posted = this.rewardSettlementCoordinator
      ? await this.rewardSettlementCoordinator.findExternalSettlement(
          attempt.id,
        )
      : null;
    // Recovers a notice whose first publish failed (deduplicated), but only
    // while the credit is still Pending: after a release or a reversal a
    // "points are pending" notice would be false (Epic 9 review P1).
    await this.recoverPendingCreditNotice(callerUserId, attempt.id, posted);

    // Epic 7 review P5 (Story 7.2 AC6): a later trigger retries an unlock that
    // failed after the first verification. Non-fatal and idempotent.
    if (this.starterPointsCoordinator) {
      await this.starterPointsCoordinator.tryUnlockStarterPoints(
        callerUserId,
        'EXTERNAL_VERIFICATION',
      );
    }

    const reward: RewardSettlementResultDto = posted ?? {
      status: 'PENDING',
      journalId: null,
      amount: 0,
      targetAccountClass: null,
      settledAt: completedAt.toISOString(),
    };
    return {
      attemptId: attempt.id,
      formId,
      // BE-7: the version the attempt was completed against (re-pinned).
      formVersionId: attempt.formVersionId,
      status: 'COMPLETED',
      completedAt: completedAt.toISOString(),
      reward,
      message:
        reward.amount > 0
          ? `Completion code already verified. +${reward.amount} points are in your Pending balance (48-hour dispute window).`
          : 'Completion code already verified.',
    };
  }

  /**
   * Decision E5-D1 (Admin recovery): forgives the account's counted wrong
   * completion codes on one FormVersion, so it may start a new attempt there
   * (3 more tries per attempt, 6 per account+version again). The locked
   * attempts and their FraudLog evidence stay; the reset is an append-only
   * audit row (Admin, reason, count, `completion-code-policy-v1`).
   */
  async resetCompletionCodeLimit(
    adminId: string,
    input: CompletionCodeLimitResetRequest,
  ): Promise<CompletionCodeLimitResetResultDto> {
    const { failuresForgiven, resetAt } =
      await this.participationRepository.resetCompletionCodeFailures({
        respondentId: input.respondentId,
        formVersionId: input.formVersionId,
        resetById: adminId,
        reason: input.reason,
        policyVersion: COMPLETION_CODE_POLICY_VERSION,
      });
    return {
      respondentId: input.respondentId,
      formVersionId: input.formVersionId,
      failuresForgiven,
      failedVerifications: 0,
      limit: COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion,
      resetAt: resetAt ? resetAt.toISOString() : null,
      policyVersion: COMPLETION_CODE_POLICY_VERSION,
    };
  }

  /**
   * Admin re-drive of an Internal reward (Epic 6 review P1/P5): settles
   * idempotently from the pinned `InternalRewardRequested` request (publisher,
   * respondent, amount and policy mode committed with the submission), never
   * from caller input. A posted settlement is returned as is.
   */
  async redriveInternalReward(
    responseId: string,
  ): Promise<InternalRewardRedriveResult> {
    const response =
      await this.participationRepository.findResponseById(responseId);
    if (!response) {
      throw new ResponseNotFoundException(
        `Survey response not found for ID "${responseId}".`,
      );
    }
    if (response.status !== 'VALIDATED' && response.status !== 'SUBMITTED') {
      throw new RewardNotSettleableException(
        'Only a submitted survey response can be rewarded.',
      );
    }
    if (response.isGuest || !response.respondentId) {
      return {
        reward: {
          status: 'SKIPPED_GUEST',
          journalId: null,
          amount: 0,
          targetAccountClass: null,
          settledAt: new Date().toISOString(),
        },
        policyMode: 'SHADOW',
      };
    }

    const coordinator = this.requireRewardSettlement();
    const request =
      await this.participationRepository.findInternalRewardRequest(responseId);
    if (!request) {
      throw new RewardNotSettleableException(
        'No reward request was recorded for this survey response.',
      );
    }

    const existing = await coordinator.findInternalSettlement(responseId);
    if (existing) {
      return { reward: existing, policyMode: request.policyMode };
    }

    const reward = await coordinator.settleInternalReward({
      responseId,
      publisherId: request.publisherId,
      respondentId: request.respondentId,
      rewardPerResponse: request.rewardAmount,
      policyMode: request.policyMode,
    });
    return { reward, policyMode: request.policyMode };
  }

  /**
   * Admin re-drive of an External Pending credit (Epic 6 review P1): the
   * attempt must be a COMPLETED External attempt; the publisher and reward
   * come from the form, the respondent from the attempt. A posted credit is
   * returned as is (idempotent).
   */
  async redriveExternalReward(
    attemptId: string,
  ): Promise<RewardSettlementResultDto | null> {
    const attempt =
      await this.participationRepository.findAttemptById(attemptId);
    if (!attempt) {
      throw new SurveyNotAvailableException('Survey attempt not found.');
    }
    if (attempt.status !== 'COMPLETED' || !attempt.respondentId) {
      throw new RewardNotSettleableException(
        'Only a completed External survey attempt can be rewarded.',
      );
    }

    const formWithVersion = await this.formRepository.findById(
      attempt.surveyId,
    );
    if (!formWithVersion) {
      throw new SurveyNotAvailableException('Survey not found.');
    }
    const { form } = formWithVersion;
    if (form.type !== 'EXTERNAL') {
      throw new AttemptNotExternalException(
        'Survey attempt is not for an external survey.',
      );
    }

    this.requireRewardSettlement();
    return this.settleExternalOrExisting(
      attempt.id,
      form.publisherId,
      attempt.respondentId,
      form.rewardPerResponse,
    );
  }

  /** Non-fatal re-drive used by the respondent's own replay. */
  private async redriveInternalRewardSafely(
    responseId: string,
  ): Promise<InternalRewardRedriveResult> {
    if (!this.rewardSettlementCoordinator) {
      return { reward: null, policyMode: 'SHADOW' };
    }
    try {
      return await this.redriveInternalReward(responseId);
    } catch (error) {
      this.logger?.warn(
        `Internal reward re-drive for response ${responseId} failed; it stays pending settlement (${errorName(error)}).`,
      );
      return { reward: null, policyMode: 'SHADOW' };
    }
  }

  /**
   * Returns the posted Pending credit, or posts it. A Publisher Escrow
   * shortfall is reported to the Respondent without the Publisher's balances
   * (Epic 6 review P11).
   */
  private async settleExternalOrExisting(
    attemptId: string,
    publisherId: string,
    respondentId: string,
    rewardPerResponse: number,
  ): Promise<RewardSettlementResultDto | null> {
    const coordinator = this.rewardSettlementCoordinator;
    if (!coordinator) {
      return null;
    }
    const existing = await coordinator.findExternalSettlement(attemptId);
    if (existing) {
      return existing;
    }
    try {
      return await coordinator.settleExternalReward({
        attemptId,
        publisherId,
        respondentId,
        rewardPerResponse,
      });
    } catch (error) {
      if (error instanceof InsufficientBalanceException) {
        throw new SurveyRewardUnavailableException();
      }
      throw error;
    }
  }

  private requireRewardSettlement(): RewardSettlementCoordinator {
    if (!this.rewardSettlementCoordinator) {
      throw new RewardNotSettleableException(
        'Reward settlement is not available.',
      );
    }
    return this.rewardSettlementCoordinator;
  }

  /**
   * Epic 8 review P3: the FR-46 limit a completion transaction re-checks
   * under the user's lock — authenticated respondents only, and only when
   * the rate limiter is configured.
   */
  private completionLimitFor(
    userId: string | null,
  ): CompletionLimitCheck | undefined {
    return userId ? this.rateLimiter?.completionLimitCheck(userId) : undefined;
  }

  /**
   * Epic 8 review P3: the completion transaction reported RATE_LIMITED (a
   * parallel completion took the last slot after the pre-check). Called
   * after that transaction or Unit of Work ended, so the FraudLog evidence
   * is never rolled back; throws the 429 `COMPLETIONS`.
   */
  private async rejectRacedCompletion(
    completionLimit: CompletionLimitCheck | undefined,
    completionTimes: Date[],
    context: CompletionCapacityContext,
  ): Promise<never> {
    if (!this.rateLimiter || !completionLimit) {
      // RATE_LIMITED is only reported for a passed limit (needs the limiter).
      throw new Error('Completion limit outcome without a completion limit.');
    }
    return this.rateLimiter.rejectCompletions(
      completionLimit.userId,
      completionTimes,
      context,
      completionLimit.now,
    );
  }

  /**
   * Rejects a too-fast submission with structured countdown data and records
   * one FraudLog TIME_BARRIER entry per attempt (FR-45, FR-47) for
   * authenticated respondents. Evidence failures never mask the rejection.
   */
  private async rejectTooFast(
    evidenceUserId: string | null,
    barrier: ResolvedTimeBarrier,
    timing: ReturnType<typeof evaluateTimeBarrier>,
    context: {
      source: 'INTERNAL_SUBMISSION' | 'EXTERNAL_COMPLETION_CODE';
      attemptId: string;
      formId: string;
      formVersionId: string;
      responseId?: string;
    },
  ): Promise<never> {
    const details: TimeBarrierRejectionDetails = {
      requiredSeconds: barrier.requiredSeconds,
      elapsedSeconds: timing.elapsedSeconds,
      remainingSeconds: timing.remainingSeconds,
      retryAfterSeconds: timing.remainingSeconds,
      earliestSubmitAt: timing.earliestSubmitAt,
      questionCount: barrier.questionCount,
      secondsPerQuestion: barrier.secondsPerQuestion,
      publisherMinimumSeconds: barrier.publisherMinimumSeconds,
      policyVersion: barrier.policyVersion,
    };

    if (evidenceUserId) {
      try {
        await this.participationRepository.recordFraudLog(
          evidenceUserId,
          'TIME_BARRIER',
          {
            ...context,
            elapsedMs: timing.elapsedMs,
            elapsedSeconds: timing.elapsedSeconds,
            requiredSeconds: barrier.requiredSeconds,
            questionCount: barrier.questionCount,
            policyVersion: barrier.policyVersion,
          },
          `time-barrier:${context.attemptId}`,
        );
      } catch {
        // Fail-closed control, fail-open evidence: still reject below.
      }
    }

    throw new SubmissionTooFastException(
      `Survey completed too quickly (${timing.elapsedSeconds}s). Required minimum effort is ${barrier.requiredSeconds} seconds. You can submit again in ${timing.remainingSeconds} seconds.`,
      details,
    );
  }

  /**
   * Replay-only recovery of the "points pending" notice (Epic 9 review P1):
   * publishes only when a positive credit journal exists and its current
   * state is still `PENDING`. A failed state lookup skips the publish (the
   * replay still returns its original result).
   */
  private async recoverPendingCreditNotice(
    respondentId: string,
    attemptId: string,
    posted: RewardSettlementResultDto | null,
  ): Promise<void> {
    if (
      !posted?.journalId ||
      posted.amount <= 0 ||
      !this.notificationPublisher ||
      !this.rewardSettlementCoordinator
    ) {
      return;
    }
    let state: string;
    try {
      state =
        await this.rewardSettlementCoordinator.getExternalCreditState(
          attemptId,
        );
    } catch (error) {
      this.logger?.warn(
        `Skipped the pending-credit notice recovery for attempt ${attemptId}: credit state lookup failed (${error instanceof Error ? error.message : String(error)}).`,
      );
      return;
    }
    if (state !== 'PENDING') {
      return;
    }
    await this.notifyPendingCredit(respondentId, attemptId, posted);
  }

  /**
   * "Points pending" notice (FR-57). Keyed like the Pending journal
   * (`external-completion:{attemptId}`), so repeating it never duplicates.
   */
  private async notifyPendingCredit(
    respondentId: string,
    attemptId: string,
    rewardResult: RewardSettlementResultDto | null,
  ): Promise<void> {
    if (!rewardResult?.journalId || rewardResult.amount <= 0) {
      return;
    }
    await this.notificationPublisher?.publish({
      userId: respondentId,
      type: 'REWARD_PENDING',
      message: `Completion code verified: ${rewardResult.amount} points are pending and will move to your Available balance after the 48-hour review window.`,
      dedupeKey: `external-completion:${attemptId}`,
    });
  }

  /**
   * Reports a missing completion code for an external survey attempt (FR-23).
   * Epic 5 review P20: External attempts only, under the COMPLETION_CODE
   * burst limit, with timing evidence for the Admin. An expired attempt may
   * still report — that is the honest "never got a code" case — also once the
   * reservation sweep marked it ABANDONED/EXPIRED (Story IR.2b Q5).
   */
  async reportMissingCompletionCode(
    formId: string | null,
    attemptId: string,
    callerUserId: string,
    input: ReportMissingCompletionCodeInput,
  ): Promise<ReportMissingCompletionCodeResponseDto> {
    await this.rateLimiter?.assertBurstAllowed(
      callerUserId,
      'COMPLETION_CODE',
      {
        formId,
        attemptId,
      },
    );

    const attempt =
      await this.participationRepository.findAttemptById(attemptId);
    if (!attempt) {
      throw new SurveyNotAvailableException('Survey attempt not found.');
    }

    if (formId && attempt.surveyId !== formId) {
      throw new SurveyNotAvailableException(
        'Survey attempt does not match the requested form.',
      );
    }

    if (attempt.respondentId !== callerUserId) {
      throw new ParticipantNotEligibleException('Unauthorized attempt access.');
    }

    const formWithVersion = await this.formRepository.findById(
      attempt.surveyId,
    );
    if (!formWithVersion) {
      throw new SurveyNotAvailableException('Survey not found.');
    }
    if (formWithVersion.form.type !== 'EXTERNAL') {
      throw new AttemptNotExternalException(
        'Survey attempt is not for an external survey.',
      );
    }

    if (attempt.status === 'LOCKED') {
      throw new AttemptLockedException();
    }

    if (attempt.status === 'COMPLETED') {
      throw new SurveyAlreadyCompletedException(
        'This survey attempt is already completed.',
      );
    }

    // Story IR.2b Q5 (default): the reservation sweep turns an expired
    // External attempt into ABANDONED/EXPIRED within minutes; the honest
    // "never got a code" report must still be accepted for it. A cancelled
    // attempt stays rejected.
    if (attempt.status === 'ABANDONED' && attempt.closedReason !== 'EXPIRED') {
      throw new AttemptExpiredException('This survey attempt was abandoned.');
    }

    const now = new Date();
    const pinnedVersion =
      findPinnedVersion(formWithVersion, attempt.formVersionId) ??
      formWithVersion.currentVersion;
    const barrier = resolveTimeBarrier('EXTERNAL', pinnedVersion);
    const elapsedMs = Math.max(0, now.getTime() - attempt.startedAt.getTime());

    const { reportedAt } =
      await this.participationRepository.reportMissingCompletionCode(
        attempt.id,
        callerUserId,
        input.reason,
        {
          startedAt: attempt.startedAt,
          elapsedSeconds: Math.floor(elapsedMs / 1000),
          requiredBarrierSeconds: barrier.requiredSeconds,
          reservationExpired: elapsedMs > RESERVATION_EXPIRY_MS,
        },
      );

    return {
      attemptId: attempt.id,
      reportedAt: reportedAt.toISOString(),
      status: 'REPORTED',
      message:
        'Your report has been submitted to RESCOM admin for review. Admins will investigate and compensate missing points within 24 working hours.',
    };
  }
}

/** Error class name only: settlement errors can carry balances. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
