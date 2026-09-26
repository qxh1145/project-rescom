import { randomUUID } from 'crypto';
import {
  CreateAttemptWithResponseParams,
  ParticipationRepositoryPort,
  QuotaStatus,
  CompleteExternalAttemptTransactionParams,
  CompleteExternalAttemptResult,
  CompletionLimitCheck,
  FraudLogType,
  InternalRewardRequest,
  MissingCodeReportEvidence,
  ResetCompletionCodeFailuresParams,
  ReserveAttemptParams,
  ReserveAttemptResult,
  SubmitInternalResponseTransactionParams,
  SubmitInternalResponseTransactionResult,
} from '../application/ports/participation-repository.port';
import type { FormCompletionRefs } from '../../forms/application/ports/form-repository.port';
import {
  AttemptCodeVerificationState,
  AttemptStatus,
  MAX_COMPLETION_CODE_FAILURES,
  MAX_COMPLETION_CODE_FAILURES_PER_ACCOUNT_VERSION,
  SurveyAttemptEntity,
} from '../domain/survey-attempt.entity';
import { ResponseEntity } from '../domain/response.entity';
import { IntegrityEventEntity } from '../domain/integrity-event.entity';
import { UncleanAttachmentException } from '../application/exceptions/participation.exceptions';

/**
 * Epic 5 review P4/P28: the slice of a Storage `StoredObject` the submit
 * transaction's attach predicate reads (owner, question, state).
 */
export interface InMemoryStoredObjectStub {
  id: string;
  ownerContext: string;
  ownerRecordId: string;
  questionId: string | null;
  status: string;
  attachedAt?: Date | null;
  /** Verified metadata; when set, it replaces the client-sent values. */
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
}

function withAttempt(
  attempt: SurveyAttemptEntity,
  changes: {
    status?: AttemptStatus;
    startedAt?: Date;
    submittedAt?: Date | null;
    codeVerification?: AttemptCodeVerificationState;
  },
): SurveyAttemptEntity {
  return new SurveyAttemptEntity(
    attempt.id,
    attempt.surveyId,
    attempt.formVersionId,
    attempt.respondentId,
    changes.status ?? attempt.status,
    attempt.isGuest,
    changes.startedAt ?? attempt.startedAt,
    changes.submittedAt === undefined
      ? attempt.submittedAt
      : changes.submittedAt,
    attempt.clientContext,
    attempt.createdAt,
    new Date(),
    changes.codeVerification ?? attempt.codeVerification,
  );
}

export class InMemoryParticipationRepository implements ParticipationRepositoryPort {
  public attempts = new Map<string, SurveyAttemptEntity>();
  public responses = new Map<string, ResponseEntity>();
  public integrityEvents: IntegrityEventEntity[] = [];
  /** Epic 5 review P4: stored objects visible to the attach predicate. */
  public storedObjects = new Map<string, InMemoryStoredObjectStub>();
  /**
   * Optional form-status lookup (Epic 6 review P6 parity): when set, starts
   * and completions of a form that is not PUBLISHED are refused.
   */
  public formStatusLookup?: (formId: string) => string | null | undefined;
  /** Decision E5-D1: Admin resets of the completion-code limit (append-only). */
  public completionCodeLimitResets: Array<
    ResetCompletionCodeFailuresParams & {
      failuresForgiven: number;
      createdAt: Date;
    }
  > = [];
  private eventKeys = new Set<string>();

  /** Decision E5-D1 parity: summed wrong codes minus Admin-forgiven ones. */
  private completionCodeFailuresSync(
    respondentId: string,
    formVersionId: string,
  ): number {
    let failed = 0;
    for (const att of this.attempts.values()) {
      if (
        att.respondentId === respondentId &&
        att.formVersionId === formVersionId
      ) {
        failed += att.codeVerification.failedCount;
      }
    }
    const forgiven = this.completionCodeLimitResets
      .filter(
        (reset) =>
          reset.respondentId === respondentId &&
          reset.formVersionId === formVersionId,
      )
      .reduce((sum, reset) => sum + reset.failuresForgiven, 0);
    return Math.max(0, failed - forgiven);
  }

  /** Decision E8-D6 parity: open attempts (any form) of the user. */
  private openAttemptStartTimesSync(
    respondentId: string,
    cutoffDate: Date,
  ): Date[] {
    return Array.from(this.attempts.values())
      .filter(
        (att) =>
          att.respondentId === respondentId &&
          att.status === 'IN_PROGRESS' &&
          att.startedAt >= cutoffDate,
      )
      .map((att) => att.startedAt)
      .sort((a, b) => a.getTime() - b.getTime());
  }

  /**
   * Test helper (decision E5-D4): unexpired IN_PROGRESS attempts of a form,
   * the shape `FormRepositoryPort.countInProgressAttempts` reports.
   */
  countInProgressAttemptsFor(formId: string, startedSince: Date): number {
    let count = 0;
    for (const att of this.attempts.values()) {
      if (
        att.surveyId === formId &&
        att.status === 'IN_PROGRESS' &&
        att.startedAt >= startedSince
      ) {
        count++;
      }
    }
    return count;
  }

  private isFormOpen(formId: string): boolean {
    if (!this.formStatusLookup) return true;
    return this.formStatusLookup(formId) === 'PUBLISHED';
  }

  private hasCompletedLogicalFormSync(
    respondentId: string,
    formId: string,
    excludeAttemptId?: string,
  ): boolean {
    for (const res of this.responses.values()) {
      if (
        res.respondentId === respondentId &&
        res.formId === formId &&
        res.attemptId !== excludeAttemptId &&
        (res.status === 'SUBMITTED' || res.status === 'VALIDATED')
      ) {
        return true;
      }
    }
    for (const att of this.attempts.values()) {
      if (
        att.respondentId === respondentId &&
        att.surveyId === formId &&
        att.id !== excludeAttemptId &&
        att.status === 'COMPLETED'
      ) {
        return true;
      }
    }
    return false;
  }

  async hasCompletedLogicalForm(
    respondentId: string,
    formId: string,
  ): Promise<boolean> {
    return this.hasCompletedLogicalFormSync(respondentId, formId);
  }

  /**
   * Epic 8 review P3 parity: the user's completion times in the rolling
   * window, oldest first, when their count reached the limit (else null).
   * The synchronous check-and-write needs no lock.
   */
  private completionTimesOverLimitSync(
    check: CompletionLimitCheck,
  ): Date[] | null {
    const sinceMs = check.now.getTime() - check.windowSeconds * 1000;
    const times: Date[] = [];
    for (const att of this.attempts.values()) {
      if (
        att.respondentId === check.userId &&
        att.status === 'COMPLETED' &&
        att.submittedAt &&
        att.submittedAt.getTime() > sinceMs
      ) {
        times.push(att.submittedAt);
      }
    }
    times.sort((a, b) => a.getTime() - b.getTime());
    return times.length >= check.limit ? times : null;
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
        this.attempts.set(id, withAttempt(att, { status: 'ABANDONED' }));
        count++;
      }
    }
    return count;
  }

  async getQuotaStatus(formId: string, cutoffDate: Date): Promise<QuotaStatus> {
    return this.quotaStatusSync(formId, cutoffDate);
  }

  private quotaStatusSync(formId: string, cutoffDate: Date): QuotaStatus {
    let completedCount = 0;
    for (const res of this.responses.values()) {
      if (
        res.formId === formId &&
        (res.status === 'SUBMITTED' || res.status === 'VALIDATED')
      ) {
        completedCount++;
      }
    }
    // Epic 5 review P28: only COMPLETED attempts WITHOUT a Response (External)
    // count here; an Internal completion is already counted by its Response.
    const attemptIdsWithResponse = new Set(
      Array.from(this.responses.values())
        .map((res) => res.attemptId)
        .filter((attemptId): attemptId is string => Boolean(attemptId)),
    );
    for (const att of this.attempts.values()) {
      if (
        att.surveyId === formId &&
        att.status === 'COMPLETED' &&
        !attemptIdsWithResponse.has(att.id)
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

  /**
   * Epic 5 review P1 parity: the same checks as the Prisma transaction. The
   * body is synchronous (no `await` between the checks and the insert), so
   * concurrent calls cannot interleave — like the form row lock.
   */
  async reserveAttempt(
    params: ReserveAttemptParams,
  ): Promise<ReserveAttemptResult> {
    if (!this.isFormOpen(params.formId)) {
      return { outcome: 'NOT_OPEN' };
    }
    if (params.respondentId) {
      if (
        this.hasCompletedLogicalFormSync(params.respondentId, params.formId)
      ) {
        return { outcome: 'ALREADY_COMPLETED' };
      }
      for (const [id, att] of this.attempts.entries()) {
        if (
          att.respondentId === params.respondentId &&
          att.surveyId === params.formId &&
          att.status === 'IN_PROGRESS' &&
          att.startedAt < params.cutoffDate
        ) {
          this.attempts.set(id, withAttempt(att, { status: 'ABANDONED' }));
        }
      }
      for (const att of this.attempts.values()) {
        if (
          att.respondentId === params.respondentId &&
          att.surveyId === params.formId &&
          att.status === 'IN_PROGRESS'
        ) {
          return { outcome: 'CONFLICTING_ACTIVE', attempt: att };
        }
      }
      if (params.completionCodeFailureLimit !== undefined) {
        const failedVerifications = this.completionCodeFailuresSync(
          params.respondentId,
          params.formVersionId,
        );
        if (failedVerifications >= params.completionCodeFailureLimit) {
          return {
            outcome: 'COMPLETION_CODE_LIMIT_REACHED',
            failedVerifications,
          };
        }
      }
      if (params.completionReservation) {
        const check = params.completionReservation;
        const sinceMs = check.now.getTime() - check.windowSeconds * 1000;
        const completionTimes = Array.from(this.attempts.values())
          .filter(
            (att) =>
              att.respondentId === check.userId &&
              att.status === 'COMPLETED' &&
              att.submittedAt !== null &&
              att.submittedAt.getTime() > sinceMs,
          )
          .map((att) => att.submittedAt as Date)
          .sort((a, b) => a.getTime() - b.getTime());
        const openAttemptStartTimes = this.openAttemptStartTimesSync(
          check.userId,
          params.cutoffDate,
        );
        if (
          completionTimes.length + openAttemptStartTimes.length >=
          check.limit
        ) {
          return {
            outcome: 'RATE_LIMITED',
            completionTimes,
            openAttemptStartTimes,
          };
        }
      }
    }
    const quota = this.quotaStatusSync(params.formId, params.cutoffDate);
    if (
      quota.completedCount + quota.activeReservationCount >=
      params.expectedCompletions
    ) {
      return { outcome: 'QUOTA_FULL' };
    }
    return { outcome: 'CREATED', ...this.insertAttemptSync(params) };
  }

  /**
   * Test seeding helper (not part of the port): inserts an attempt (and, for
   * INTERNAL, its Response) without any of the start checks.
   */
  async createAttemptWithResponse(
    params: CreateAttemptWithResponseParams,
  ): Promise<{
    attempt: SurveyAttemptEntity;
    response: ResponseEntity | null;
  }> {
    return this.insertAttemptSync(params);
  }

  private insertAttemptSync(params: CreateAttemptWithResponseParams): {
    attempt: SurveyAttemptEntity;
    response: ResponseEntity | null;
  } {
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

  async findResponseById(responseId: string): Promise<ResponseEntity | null> {
    return this.responses.get(responseId) ?? null;
  }

  async findResponseByAttemptId(
    attemptId: string,
  ): Promise<ResponseEntity | null> {
    for (const res of this.responses.values()) {
      if (res.attemptId === attemptId) {
        return res;
      }
    }
    return null;
  }

  public activePolicy: {
    id: string;
    name: string;
    version: number;
    status: 'SHADOW' | 'ADVISORY' | 'ENFORCED';
  } | null = null;

  async findActivePolicyDeployment(): Promise<{
    id: string;
    name: string;
    version: number;
    status: 'SHADOW' | 'ADVISORY' | 'ENFORCED';
  } | null> {
    return this.activePolicy;
  }

  public outboxEvents: Array<{
    id: string;
    eventType: string;
    idempotencyKey: string;
    payload: any;
  }> = [];

  public outboxOrderingStreams = new Map<string, string>();

  /**
   * Epic 5 review P7/P4/P28 parity: state predicates, the one-completion
   * rule and the attach predicate of the Prisma transaction. A rejected
   * attachment leaves everything untouched (rollback).
   */
  async submitInternalResponseTransaction(
    params: SubmitInternalResponseTransactionParams,
  ): Promise<SubmitInternalResponseTransactionResult> {
    if (!this.isFormOpen(params.formId)) {
      return { outcome: 'FORM_NOT_OPEN' };
    }
    const existingResponse = this.responses.get(params.responseId);
    const existingAttempt = this.attempts.get(params.attemptId);
    if (
      !existingResponse ||
      !existingAttempt ||
      existingResponse.attemptId !== existingAttempt.id
    ) {
      return { outcome: 'NOT_SUBMITTABLE' };
    }
    if (
      existingResponse.status !== 'IN_PROGRESS' ||
      existingAttempt.status === 'COMPLETED'
    ) {
      return { outcome: 'ALREADY_SUBMITTED' };
    }
    if (existingAttempt.status !== 'IN_PROGRESS') {
      return { outcome: 'NOT_SUBMITTABLE' };
    }
    if (
      params.respondentId &&
      !params.isGuest &&
      this.hasCompletedLogicalFormSync(
        params.respondentId,
        params.formId,
        params.attemptId,
      )
    ) {
      return { outcome: 'ALREADY_COMPLETED_LOGICAL' };
    }
    if (params.completionLimit) {
      const completionTimes = this.completionTimesOverLimitSync(
        params.completionLimit,
      );
      if (completionTimes) {
        return { outcome: 'RATE_LIMITED', completionTimes };
      }
    }

    // Attach predicate first: a rejection must leave no partial writes.
    const attachments = params.attachments ?? [];
    const toAttach = attachments.map((attachment) =>
      this.storedObjects.get(attachment.objectId),
    );
    const allAttachable = toAttach.every(
      (object, index) =>
        object !== undefined &&
        object.ownerContext === 'participation' &&
        object.ownerRecordId === params.attemptId &&
        object.questionId === attachments[index].questionId &&
        object.status === 'CLEAN',
    );
    if (!allAttachable) {
      throw new UncleanAttachmentException();
    }
    for (const object of toAttach) {
      if (object) {
        this.storedObjects.set(object.id, {
          ...object,
          status: 'ATTACHED',
          attachedAt: params.submittedAt,
        });
      }
    }
    // Stored answers carry the verified file metadata (Prisma parity).
    const answers: Record<string, unknown> = { ...params.answers };
    for (const attachment of attachments) {
      const files = answers[attachment.questionId];
      const object = this.storedObjects.get(attachment.objectId);
      if (!Array.isArray(files) || !object?.fileName) continue;
      answers[attachment.questionId] = files.map((file) =>
        (file as { objectId?: string })?.objectId === object.id
          ? {
              objectId: object.id,
              fileName: object.fileName,
              fileSize: object.fileSize,
              mimeType: object.mimeType,
              status: 'CLEAN',
            }
          : file,
      );
    }

    const updatedResponse = new ResponseEntity(
      existingResponse.id,
      existingResponse.formId,
      existingResponse.formVersionId,
      existingResponse.attemptId,
      existingResponse.respondentId,
      'VALIDATED',
      answers,
      existingResponse.ipAddress,
      existingResponse.isGuest,
      params.submittedAt,
      existingResponse.createdAt,
      new Date(),
    );
    this.responses.set(updatedResponse.id, updatedResponse);

    const updatedAttempt = withAttempt(existingAttempt, {
      status: 'COMPLETED',
      submittedAt: params.submittedAt,
    });
    this.attempts.set(updatedAttempt.id, updatedAttempt);

    const outboxEventIds: string[] = [];

    if (params.respondentId && !params.isGuest) {
      const rewardId = randomUUID();
      outboxEventIds.push(rewardId);
      this.outboxEvents.push({
        id: rewardId,
        eventType: 'InternalRewardRequested',
        idempotencyKey: `internal-reward:${params.responseId}`,
        payload: {
          responseId: params.responseId,
          attemptId: params.attemptId,
          formId: params.formId,
          formVersionId: params.formVersionId,
          publisherId: params.publisherId,
          respondentId: params.respondentId,
          rewardAmount: params.rewardAmount,
          policyMode: params.policyMode,
          policyDeploymentId: params.policyDeploymentId,
          submittedAt: params.submittedAt.toISOString(),
        },
      });
      this.outboxOrderingStreams.set(
        rewardId,
        `internal-reward:${params.responseId}`,
      );
    }

    const assessmentId = randomUUID();
    outboxEventIds.push(assessmentId);
    this.outboxEvents.push({
      id: assessmentId,
      eventType: 'IntegrityAssessmentRequested',
      idempotencyKey: `integrity-assessment:${params.responseId}:${params.policyDeploymentId}`,
      payload: {
        responseId: params.responseId,
        attemptId: params.attemptId,
        formId: params.formId,
        formVersionId: params.formVersionId,
        respondentId: params.respondentId,
        policyMode: params.policyMode,
        policyDeploymentId: params.policyDeploymentId,
        answers,
        submittedAt: params.submittedAt.toISOString(),
        ...(params.securityEvidence
          ? { securityEvidence: params.securityEvidence }
          : {}),
      },
    });
    this.outboxOrderingStreams.set(
      assessmentId,
      `integrity:${params.responseId}`,
    );

    return {
      outcome: 'SUBMITTED',
      response: updatedResponse,
      attempt: updatedAttempt,
      outboxEventIds,
    };
  }

  async saveIntegrityEvents(events: IntegrityEventEntity[]): Promise<number> {
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

  public fraudLogs: Array<{
    userId: string;
    type: string;
    details?: Record<string, unknown>;
    dedupeKey?: string;
    createdAt: Date;
  }> = [];

  async lockAttemptForVerification(
    attemptId: string,
  ): Promise<SurveyAttemptEntity | null> {
    return this.attempts.get(attemptId) ?? null;
  }

  async recordFailedAttemptVerification(
    attemptId: string,
    respondentId: string,
    formVersionId: string,
  ): Promise<{
    failureCount: number;
    isLocked: boolean;
    accountFailureCount: number;
  }> {
    const att = this.attempts.get(attemptId);
    // Epic 5 review P2: the server-owned counter only (never clientContext).
    const currentFailures = att?.codeVerification.failedCount ?? 0;
    const accountFailuresBefore = this.completionCodeFailuresSync(
      respondentId,
      formVersionId,
    );
    if (!att || att.status !== 'IN_PROGRESS') {
      return {
        failureCount: currentFailures,
        isLocked: att?.status === 'LOCKED',
        accountFailureCount: accountFailuresBefore,
      };
    }
    const failureCount = currentFailures + 1;
    const accountFailureCount = accountFailuresBefore + 1;
    const isLocked =
      failureCount >= MAX_COMPLETION_CODE_FAILURES ||
      accountFailureCount >= MAX_COMPLETION_CODE_FAILURES_PER_ACCOUNT_VERSION;

    this.attempts.set(
      attemptId,
      withAttempt(att, {
        status: isLocked ? 'LOCKED' : att.status,
        codeVerification: {
          ...att.codeVerification,
          failedCount: failureCount,
          lastFailedAt: new Date(),
        },
      }),
    );

    this.fraudLogs.push({
      userId: respondentId,
      type: 'SECURITY_VIOLATION',
      details: {
        attemptId,
        formVersionId,
        action: 'COMPLETION_CODE_VERIFICATION_FAILED',
        failureCount,
        accountFailureCount,
        isLocked,
      },
      createdAt: new Date(),
    });

    return { failureCount, isLocked, accountFailureCount };
  }

  async countCompletionCodeFailures(
    respondentId: string,
    formVersionId: string,
  ): Promise<number> {
    return this.completionCodeFailuresSync(respondentId, formVersionId);
  }

  async resetCompletionCodeFailures(
    params: ResetCompletionCodeFailuresParams,
  ): Promise<{ failuresForgiven: number; resetAt: Date | null }> {
    const counted = this.completionCodeFailuresSync(
      params.respondentId,
      params.formVersionId,
    );
    if (counted <= 0) {
      return { failuresForgiven: 0, resetAt: null };
    }
    const createdAt = new Date();
    this.completionCodeLimitResets.push({
      ...params,
      failuresForgiven: counted,
      createdAt,
    });
    return { failuresForgiven: counted, resetAt: createdAt };
  }

  async findOpenAttemptStartTimes(
    respondentId: string,
    cutoffDate: Date,
  ): Promise<Date[]> {
    return this.openAttemptStartTimesSync(respondentId, cutoffDate);
  }

  async recordFraudLog(
    userId: string,
    type: FraudLogType,
    details?: Record<string, unknown>,
    dedupeKey?: string,
  ): Promise<boolean> {
    if (
      dedupeKey &&
      this.fraudLogs.some((entry) => entry.dedupeKey === dedupeKey)
    ) {
      return false;
    }
    this.fraudLogs.push({
      userId,
      type,
      details,
      ...(dedupeKey ? { dedupeKey } : {}),
      createdAt: new Date(),
    });
    return true;
  }

  async findCompletionTimesSince(
    respondentId: string,
    since: Date,
  ): Promise<Date[]> {
    const times: Date[] = [];
    for (const att of this.attempts.values()) {
      if (
        att.respondentId === respondentId &&
        att.status === 'COMPLETED' &&
        att.submittedAt &&
        att.submittedAt.getTime() >= since.getTime()
      ) {
        times.push(att.submittedAt);
      }
    }
    return times.sort((a, b) => a.getTime() - b.getTime());
  }

  async completeExternalAttemptTransaction(
    params: CompleteExternalAttemptTransactionParams,
  ): Promise<CompleteExternalAttemptResult> {
    const att = this.attempts.get(params.attemptId);
    if (!att) {
      throw new Error(`Attempt ${params.attemptId} not found`);
    }
    if (att.status === 'COMPLETED') {
      return { outcome: 'ALREADY_COMPLETED', attempt: att };
    }
    if (att.status !== 'IN_PROGRESS') {
      return { outcome: 'NOT_CLAIMABLE', attempt: att };
    }
    if (!this.isFormOpen(params.formId)) {
      return { outcome: 'FORM_NOT_OPEN', attempt: att };
    }
    if (
      att.respondentId &&
      this.hasCompletedLogicalFormSync(att.respondentId, att.surveyId, att.id)
    ) {
      return { outcome: 'ALREADY_COMPLETED_LOGICAL', attempt: att };
    }
    if (params.completionLimit) {
      const completionTimes = this.completionTimesOverLimitSync(
        params.completionLimit,
      );
      if (completionTimes) {
        return { outcome: 'RATE_LIMITED', attempt: att, completionTimes };
      }
    }

    const updated = withAttempt(att, {
      status: 'COMPLETED',
      submittedAt: params.submittedAt,
    });
    this.attempts.set(params.attemptId, updated);
    return { outcome: 'COMPLETED', attempt: updated };
  }

  async findInternalRewardRequest(
    responseId: string,
  ): Promise<InternalRewardRequest | null> {
    const event = this.outboxEvents.find(
      (candidate) =>
        candidate.idempotencyKey === `internal-reward:${responseId}`,
    );
    if (!event) return null;
    return {
      publisherId: event.payload.publisherId,
      respondentId: event.payload.respondentId,
      rewardAmount: event.payload.rewardAmount,
      policyMode: event.payload.policyMode ?? 'SHADOW',
    };
  }

  /**
   * Test helper (Epic 6 review P4): this store's completions of a form, in
   * the shape `FormRepositoryPort.listRewardableCompletions` returns, so an
   * in-memory form repository can see real submissions/verifications.
   */
  completionRefsFor(formId: string): FormCompletionRefs {
    const responses = Array.from(this.responses.values()).filter(
      (response) => response.formId === formId,
    );
    const responseAttemptIds = new Set(
      Array.from(this.responses.values())
        .map((response) => response.attemptId)
        .filter((attemptId): attemptId is string => Boolean(attemptId)),
    );
    const completedResponses = responses.filter(
      (response) =>
        response.status === 'SUBMITTED' || response.status === 'VALIDATED',
    );
    const externalAttemptIds = Array.from(this.attempts.values())
      .filter(
        (attempt) =>
          attempt.surveyId === formId &&
          attempt.status === 'COMPLETED' &&
          !responseAttemptIds.has(attempt.id),
      )
      .map((attempt) => attempt.id);
    return {
      completedCount: completedResponses.length + externalAttemptIds.length,
      internalResponses: responses
        .filter(
          (response) =>
            !response.isGuest &&
            response.respondentId !== null &&
            response.status !== 'IN_PROGRESS',
        )
        .map((response) => ({
          id: response.id,
          rewardable:
            response.status === 'SUBMITTED' || response.status === 'VALIDATED',
        })),
      externalAttemptIds,
    };
  }

  async reportMissingCompletionCode(
    attemptId: string,
    respondentId: string,
    reason: string,
    evidence: MissingCodeReportEvidence,
  ): Promise<{ reportedAt: Date }> {
    const att = this.attempts.get(attemptId);
    // Epic 5 review P2: server-owned marker (compare-and-set), never JSON.
    if (att?.codeVerification.missingCodeReportedAt) {
      return { reportedAt: att.codeVerification.missingCodeReportedAt };
    }

    const reportedAt = new Date();
    if (att) {
      this.attempts.set(
        attemptId,
        withAttempt(att, {
          codeVerification: {
            ...att.codeVerification,
            missingCodeReportedAt: reportedAt,
            missingCodeReason: reason,
          },
        }),
      );
    }

    this.outboxEvents.push({
      id: randomUUID(),
      eventType: 'ExternalCompletionCodeMissingReported',
      idempotencyKey: `missing-code-report:${attemptId}`,
      payload: {
        attemptId,
        surveyId: att?.surveyId ?? null,
        formVersionId: att?.formVersionId ?? null,
        respondentId,
        reason,
        reportedAt: reportedAt.toISOString(),
        startedAt: evidence.startedAt.toISOString(),
        elapsedSeconds: evidence.elapsedSeconds,
        requiredBarrierSeconds: evidence.requiredBarrierSeconds,
        reservationExpired: evidence.reservationExpired,
      },
    });

    return { reportedAt };
  }
}
