import { SurveyAttemptEntity } from '../../domain/survey-attempt.entity';
import { ResponseEntity } from '../../domain/response.entity';
import { IntegrityEventEntity } from '../../domain/integrity-event.entity';
import type { SecurityEvidence } from '@rescom/schemas';

export type FraudLogType =
  | 'TIME_BARRIER'
  | 'RATE_LIMIT'
  | 'DEMO_MISMATCH'
  | 'RECAPTCHA_FAIL'
  | 'SECURITY_VIOLATION';

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

/**
 * Epic 5 review P1: everything an attempt start must check and write in one
 * transaction under the form row lock.
 */
export interface ReserveAttemptParams extends CreateAttemptWithResponseParams {
  /** The logical Form's quota (completed + active reservations). */
  expectedCompletions: number;
  /** Attempts started before it no longer hold a reservation. */
  cutoffDate: Date;
  /**
   * Decision E8-D6 (FR-46): the completion limit is reserved at start. The
   * transaction takes the user's completion lock FIRST (the same lock, and
   * the same order, as every completion transaction) and refuses the start
   * when the user's completions in the window plus their open attempts
   * (unexpired IN_PROGRESS, any form) reached the limit.
   */
  completionReservation?: CompletionLimitCheck;
  /**
   * Decision E5-D1 (`completion-code-policy-v1`): External starts of an
   * account — refused when the account's counted wrong codes on
   * `formVersionId` reached this limit.
   */
  completionCodeFailureLimit?: number;
}

/**
 * CREATED: the attempt (and, for INTERNAL, its Response) was committed.
 * NOT_OPEN: the form or its pinned version is not published any more.
 * ALREADY_COMPLETED: the account completed this logical Form.
 * CONFLICTING_ACTIVE: the account has an unexpired IN_PROGRESS attempt
 *   (`attempt` is null when only the unique index caught the race).
 * QUOTA_FULL: completed + active reservations reached the quota.
 * COMPLETION_CODE_LIMIT_REACHED: the account used every completion-code try
 *   on this FormVersion (decision E5-D1); nothing was written.
 * RATE_LIMITED: the user's completions in the window + open attempts reached
 *   the FR-46 limit (decision E8-D6); nothing was written. Both lists are
 *   oldest first.
 */
export type ReserveAttemptResult =
  | {
      outcome: 'CREATED';
      attempt: SurveyAttemptEntity;
      response: ResponseEntity | null;
    }
  | { outcome: 'NOT_OPEN' }
  | { outcome: 'ALREADY_COMPLETED' }
  | { outcome: 'CONFLICTING_ACTIVE'; attempt: SurveyAttemptEntity | null }
  | { outcome: 'QUOTA_FULL' }
  | { outcome: 'COMPLETION_CODE_LIMIT_REACHED'; failedVerifications: number }
  | {
      outcome: 'RATE_LIMITED';
      completionTimes: Date[];
      openAttemptStartTimes: Date[];
    };

/** Decision E5-D1: an Admin's recovery of the completion-code limit. */
export interface ResetCompletionCodeFailuresParams {
  respondentId: string;
  formVersionId: string;
  resetById: string;
  reason: string;
  policyVersion: string;
}

/** Epic 5 review P20: timing evidence of a missing-code report for the Admin. */
export interface MissingCodeReportEvidence {
  startedAt: Date;
  elapsedSeconds: number;
  requiredBarrierSeconds: number;
  reservationExpired: boolean;
}

/** Story IR.2a (API-03): the owner's request to cancel one attempt. */
export interface CancelAttemptParams {
  attemptId: string;
  respondentId: string;
  formId: string;
  /** Attempts started before it no longer hold a reservation (expired). */
  cutoffDate: Date;
  /** `closedAt` of the transition. */
  now: Date;
}

/**
 * CANCELLED: this call moved the attempt IN_PROGRESS -> ABANDONED/CANCELLED.
 * ALREADY_CANCELLED: an earlier (or concurrent) cancel did; nothing was
 *   written and `attempt.closedAt` is the original time.
 * NOT_IN_PROGRESS: the attempt is COMPLETED, LOCKED, ABANDONED for another
 *   reason, or IN_PROGRESS with an expired reservation (`derivedCloseReason`
 *   EXPIRED); nothing was written.
 * NOT_FOUND: no attempt of this respondent (unknown, guest or another
 *   user's) on this form.
 */
export type CancelAttemptResult =
  | { outcome: 'CANCELLED' | 'ALREADY_CANCELLED'; attempt: SurveyAttemptEntity }
  | {
      outcome: 'NOT_IN_PROGRESS';
      attempt: SurveyAttemptEntity;
      derivedCloseReason: 'EXPIRED' | null;
    }
  | { outcome: 'NOT_FOUND' };

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
   * Lazily marks expired attempts for this respondent and form as ABANDONED
   * (closed reason EXPIRED, Story IR.2a).
   */
  abandonExpiredAttempts(
    respondentId: string,
    formId: string,
    cutoffDate: Date,
  ): Promise<number>;

  /**
   * Story IR.2b Task 8 (AC4; closes Epic 5 DF7): the reservation-expiry
   * sweep. Moves up to `limit` IN_PROGRESS attempts started before `cutoff`
   * (oldest first) to ABANDONED with closed reason EXPIRED. Locks only the
   * attempt rows, `FOR UPDATE SKIP LOCKED`, and updates conditionally on
   * IN_PROGRESS, so it never waits on — and always loses to — a submit or
   * verification holding the row. The quota already ignores these attempts
   * (time window), so quota numbers do not change.
   */
  abandonExpiredAttemptsBatch(
    cutoff: Date,
    limit: number,
    now: Date,
  ): Promise<{ abandonedIds: string[] }>;

  /**
   * Retrieves the current quota usage (completed responses + active unexpired reservations).
   */
  getQuotaStatus(formId: string, cutoffDate: Date): Promise<QuotaStatus>;

  /**
   * Epic 5 review P1 (AD-19, FR-25): in ONE transaction under the form row
   * lock, re-checks that the form is open, the account's logical completion,
   * its conflicting active attempt and the quota, then commits the
   * SurveyAttempt (expiring reservation) and, for INTERNAL, its one-to-one
   * IN_PROGRESS Response. Concurrent starts serialize per form; partial
   * unique indexes back the account rules.
   */
  reserveAttempt(params: ReserveAttemptParams): Promise<ReserveAttemptResult>;

  /**
   * Finds an attempt by its ID.
   */
  findAttemptById(attemptId: string): Promise<SurveyAttemptEntity | null>;

  /**
   * Finds a response by its ID.
   */
  findResponseById(responseId: string): Promise<ResponseEntity | null>;

  /**
   * Finds a response by its associated attempt ID.
   */
  findResponseByAttemptId(attemptId: string): Promise<ResponseEntity | null>;

  /**
   * Finds the currently active ScoringPolicy deployment, or null if none is configured.
   */
  findActivePolicyDeployment(): Promise<{
    id: string;
    name: string;
    version: number;
    status: 'SHADOW' | 'ADVISORY' | 'ENFORCED';
  } | null>;

  /**
   * Atomically commits internal form submission:
   * - Transitions Response to VALIDATED with answersJson and submittedAt.
   * - Transitions SurveyAttempt to COMPLETED with submittedAt.
   * - Creates independent OutboxEvents (InternalRewardRequested and IntegrityAssessmentRequested).
   * - Attaches any verified uploaded StoredObject records.
   * With `completionLimit`, the FR-46 limit is re-checked under the user's
   * completion lock before any write (Epic 8 review P3).
   */
  submitInternalResponseTransaction(
    params: SubmitInternalResponseTransactionParams,
  ): Promise<SubmitInternalResponseTransactionResult>;

  /**
   * Idempotently persists a batch of behavioral integrity events.
   * Duplicate events with identical (attemptId, clientEventId) are skipped.
   */
  saveIntegrityEvents(events: IntegrityEventEntity[]): Promise<number>;

  /**
   * Epic 5 review P6: locks the attempt row (`FOR UPDATE`, after the
   * `FOR NO KEY UPDATE` lock on its form row, plan 2.3) for a completion-code check and returns its
   * current state, including the server-owned strike counter. Joins the
   * caller's Unit of Work, so the status check, the code comparison and the
   * strike or claim form one serialized unit per attempt.
   * With `completionLockUserId` it first takes that user's completion lock
   * (Epic 8 review P3), so the Unit of Work keeps the lock order of every
   * completion transaction: user completion lock -> form row -> attempt row.
   */
  lockAttemptForVerification(
    attemptId: string,
    formId: string,
    completionLockUserId?: string,
  ): Promise<SurveyAttemptEntity | null>;

  /**
   * Records a failed code verification attempt in the server-owned counter
   * (Epic 5 review P2; never `clientContext`). Increments the failure count;
   * the attempt becomes LOCKED at 3 wrong codes, or when the account's
   * counted wrong codes on the FormVersion reach 6 (decision E5-D1,
   * `completion-code-policy-v1`); logs a SECURITY_VIOLATION to FraudLog.
   * An IN_PROGRESS attempt pinned to another version is first re-pinned to
   * `formVersionId` (BE-7, decision D4), so its earlier strikes count there
   * too. Joins the caller's Unit of Work.
   */
  recordFailedAttemptVerification(
    attemptId: string,
    respondentId: string,
    formVersionId: string,
  ): Promise<{
    failureCount: number;
    isLocked: boolean;
    /** The account's counted wrong codes on the FormVersion, this one included. */
    accountFailureCount: number;
    /** False when the attempt was no longer IN_PROGRESS: no strike was recorded. */
    attemptInProgress: boolean;
  }>;

  /**
   * Decision E5-D1: the account's counted wrong completion codes on one
   * FormVersion — SUM of its attempts' server-owned counters minus what an
   * Admin forgave. Joins the caller's Unit of Work.
   */
  countCompletionCodeFailures(
    respondentId: string,
    formVersionId: string,
  ): Promise<number>;

  /**
   * Decision E5-D1 (Admin recovery): forgives the account's counted wrong
   * codes on the FormVersion with an append-only audit row, serialized with
   * in-flight verifications of those attempts. Writes nothing (and returns
   * `resetAt: null`) when nothing is counted.
   */
  resetCompletionCodeFailures(
    params: ResetCompletionCodeFailuresParams,
  ): Promise<{ failuresForgiven: number; resetAt: Date | null }>;

  /**
   * Decision E8-D6: start times of the respondent's open attempts (IN_PROGRESS
   * and started on or after `cutoffDate`, on any form), oldest first — the
   * reservations the FR-46 completion limit counts at start.
   */
  findOpenAttemptStartTimes(
    respondentId: string,
    cutoffDate: Date,
  ): Promise<Date[]>;

  /**
   * Appends a FraudLog entry (append-only, FR-47) for a confirmed hard-rule
   * violation (e.g. TIME_BARRIER, RATE_LIMIT, SECURITY_VIOLATION).
   * With a `dedupeKey` the entry is written at most once (Story 8.2: one
   * TIME_BARRIER row per attempt, one RATE_LIMIT row per window).
   * Returns whether a new row was written.
   */
  recordFraudLog(
    userId: string,
    type: FraudLogType,
    details?: Record<string, unknown>,
    dedupeKey?: string,
  ): Promise<boolean>;

  /**
   * Submission times of the respondent's COMPLETED attempts (Internal and
   * External) with `submittedAt >= since`, oldest first. PostgreSQL-authoritative
   * input of the FR-46 rolling-window completion limit.
   */
  findCompletionTimesSince(respondentId: string, since: Date): Promise<Date[]>;

  /**
   * Locks the external SurveyAttempt and transitions it IN_PROGRESS -> COMPLETED.
   * Joins the caller's Unit of Work so the claim commits or rolls back together
   * with the Economy Pending journal (AD-16). Never overwrites a non-IN_PROGRESS state.
   * With `completionLimit`, the FR-46 limit is re-checked under the user's
   * completion lock before the claim (Epic 8 review P3).
   */
  completeExternalAttemptTransaction(
    params: CompleteExternalAttemptTransactionParams,
  ): Promise<CompleteExternalAttemptResult>;

  /**
   * The `InternalRewardRequested` Outbox payload committed with the
   * submission (`internal-reward:{responseId}`): the pinned publisher,
   * respondent, amount and policy mode of the reward (Epic 6 review P5), or
   * null when none was recorded (guest or legacy submission).
   */
  findInternalRewardRequest(
    responseId: string,
  ): Promise<InternalRewardRequest | null>;

  /**
   * Records a missing completion code report on the survey attempt (FR-23)
   * in the server-owned marker (Epic 5 review P2): the first report writes
   * the marker and exactly one Outbox row; a repeat returns the stored time.
   */
  reportMissingCompletionCode(
    attemptId: string,
    respondentId: string,
    reason: string,
    evidence: MissingCodeReportEvidence,
  ): Promise<{ reportedAt: Date }>;

  /**
   * Story IR.2a (API-03): in ONE transaction, under the form row lock
   * (`FOR SHARE`) and then the attempt row lock (`FOR UPDATE`) — the lock
   * order of start, submit and verify — moves an owned, unexpired
   * IN_PROGRESS attempt to ABANDONED with closed reason CANCELLED, which
   * releases its quota reservation (quota counts unexpired IN_PROGRESS
   * attempts only). State-predicated: a replay never rewrites `closedAt`.
   */
  cancelAttempt(params: CancelAttemptParams): Promise<CancelAttemptResult>;
}

/**
 * Epic 8 review P3 (FR-46): the completion limit a completion transaction
 * re-checks before any write. The transaction first takes the user's
 * completion lock (PostgreSQL: a transaction-scoped advisory lock keyed by
 * the user), so parallel completions of one user on different surveys
 * serialize and the rolling-window count cannot be raced past the cap.
 * Lock order in every completion transaction: user completion lock ->
 * `forms` row `FOR NO KEY UPDATE` (Epic 6 review P6; exclusive since plan 2.3
 * so completions of one survey serialize and the one that meets the sample
 * target sees every earlier one and closes the survey in its own
 * transaction) -> attempt row `FOR UPDATE` (Epic 5 review P7). Attempt start with a completion reservation (decision
 * E8-D6) takes the same user lock first, then the form row `FOR NO KEY
 * UPDATE`, so every path takes the user lock before any row lock and no
 * inversion exists.
 */
export interface CompletionLimitCheck {
  userId: string;
  /** Max COMPLETED attempts with `submittedAt > now - windowSeconds`. */
  limit: number;
  windowSeconds: number;
  now: Date;
}

export interface CompleteExternalAttemptTransactionParams {
  attemptId: string;
  respondentId: string;
  formId: string;
  /**
   * The version whose code was verified; the claim re-pins the attempt to it
   * (BE-7, decision D4: newer than the attempt's after a code rotation).
   */
  formVersionId: string;
  submittedAt: Date;
  /** Authenticated respondents, when a rate limiter is configured. */
  completionLimit?: CompletionLimitCheck;
}

/**
 * COMPLETED: this call claimed the attempt.
 * ALREADY_COMPLETED: a previous (or concurrent) call claimed it first.
 * NOT_CLAIMABLE: the attempt is LOCKED, ABANDONED or otherwise not IN_PROGRESS.
 * FORM_NOT_OPEN: the survey is no longer PUBLISHED (read under a row lock
 * that serializes with the close, Epic 6 review P6); nothing was written.
 * ALREADY_COMPLETED_LOGICAL: the account already completed this logical
 * Form with another attempt (Epic 5 review P1); nothing was written.
 * RATE_LIMITED: the user reached the FR-46 completion limit (Epic 8 review
 * P3); nothing was written. `completionTimes` are the completions in the
 * window, oldest first.
 */
export type CompleteExternalAttemptResult =
  | {
      outcome:
        | 'COMPLETED'
        | 'ALREADY_COMPLETED'
        | 'NOT_CLAIMABLE'
        | 'FORM_NOT_OPEN'
        | 'ALREADY_COMPLETED_LOGICAL';
      attempt: SurveyAttemptEntity;
    }
  | {
      outcome: 'RATE_LIMITED';
      attempt: SurveyAttemptEntity;
      completionTimes: Date[];
    };

/** Pinned reward request of an Internal submission (Epic 6 review P5). */
export interface InternalRewardRequest {
  publisherId: string;
  respondentId: string;
  /**
   * The advertised reward credited to the Respondent in full (decision
   * E6-D1): the Escrow pays `internalRewardFunding(rewardAmount).escrowDraw`
   * and SYSTEM_ISSUANCE the rest, in one journal.
   */
  rewardAmount: number;
  policyMode: 'SHADOW' | 'ADVISORY' | 'ENFORCED';
}

export interface SubmitInternalResponseTransactionParams {
  responseId: string;
  attemptId: string;
  formId: string;
  formVersionId: string;
  respondentId: string | null;
  isGuest: boolean;
  answers: Record<string, unknown>;
  submittedAt: Date;
  policyMode: 'SHADOW' | 'ADVISORY' | 'ENFORCED';
  policyDeploymentId: string;
  /** The advertised reward (Outbox `rewardAmount`, see `InternalRewardRequest`). */
  rewardAmount: number;
  publisherId: string;
  /**
   * Epic 5 review P4: every file answer, with the question it answers. The
   * transaction attaches exactly these objects — CLEAN, owned by this
   * attempt and uploaded for that question — or rejects the submission.
   */
  attachments?: SubmissionAttachment[];
  /** Story 8.2: hard-control evidence forwarded in IntegrityAssessmentRequested. */
  securityEvidence?: SecurityEvidence;
  /** Authenticated respondents, when a rate limiter is configured. */
  completionLimit?: CompletionLimitCheck;
  /**
   * Plan 2.3 (decision A): runs inside the submission's transaction after its
   * completion writes, still under the form row lock — the survey's QUOTA
   * close and Escrow refund commit or roll back with the last submission.
   */
  afterCompletion?: () => Promise<void>;
}

export interface SubmissionAttachment {
  objectId: string;
  questionId: string;
}

/**
 * Epic 5 review P7: the submit transaction's state-predicated outcome.
 * SUBMITTED: this call committed Response VALIDATED + Attempt COMPLETED +
 *   the Outbox events.
 * ALREADY_SUBMITTED: a previous (or concurrent) call committed it; nothing
 *   was written (the caller replays the original result).
 * NOT_SUBMITTABLE: the attempt is no longer IN_PROGRESS (abandoned, locked);
 *   nothing was written.
 * ALREADY_COMPLETED_LOGICAL: the account completed this logical Form with
 *   another attempt (Epic 5 review P1); nothing was written.
 * FORM_NOT_OPEN: the survey is no longer PUBLISHED (Epic 6 review P6).
 * RATE_LIMITED: the user reached the FR-46 completion limit (Epic 8 review
 *   P3); nothing was written. Checked after the attempt state, so a
 *   duplicate submit still resolves to ALREADY_SUBMITTED.
 */
export type SubmitInternalResponseTransactionResult =
  | {
      outcome: 'SUBMITTED';
      response: ResponseEntity;
      attempt: SurveyAttemptEntity;
      outboxEventIds: string[];
    }
  | {
      outcome:
        | 'ALREADY_SUBMITTED'
        | 'NOT_SUBMITTABLE'
        | 'ALREADY_COMPLETED_LOGICAL'
        | 'FORM_NOT_OPEN';
    }
  | { outcome: 'RATE_LIMITED'; completionTimes: Date[] };
