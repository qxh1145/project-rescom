export const SURVEY_RESPONSE_REPOSITORY_PORT = Symbol(
  'SURVEY_RESPONSE_REPOSITORY_PORT',
);

export type SurveyResponseStatus =
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'VALIDATED'
  | 'DISPUTED'
  | 'REJECTED'
  | 'ABANDONED';

export interface RecordResponseParams {
  formId: string;
  formVersionId?: string;
  respondentId?: string | null;
  status: SurveyResponseStatus;
}

export interface CreateGuestSubmissionParams {
  formId: string;
  formVersionId: string;
  answers: Record<string, unknown>;
  ipAddress: string;
  telemetry?: Record<string, unknown>;
}

export interface GuestSubmissionEntity {
  id: string;
  formId: string;
  formVersionId: string;
  status: 'SUBMITTED';
  isGuest: true;
  rewardEarned: 0;
  integrityStatus: 'ASSESSED';
  respondentReliability: 'NOT_AVAILABLE';
  submittedAt: Date;
}

/**
 * Bug 3.3: a guest submission reserves its quota slot atomically. The
 * reservation cutoff is the same one participation's `reserveAttempt` uses
 * (`now - RESERVATION_EXPIRY_MS`), so guests and paid respondents see the same
 * quota: completions + unexpired IN_PROGRESS attempts.
 */
export interface CreateGuestResponseWithinQuotaParams extends CreateGuestSubmissionParams {
  cutoffDate: Date;
  /**
   * Plan 2.3: runs in the same transaction after the guest response was
   * written, under the form row lock — the QUOTA close when this guest filled
   * the last slot.
   */
  afterCreate?: () => Promise<void>;
}

export type CreateGuestResponseWithinQuotaResult =
  | { outcome: 'CREATED'; response: GuestSubmissionEntity }
  | { outcome: 'NOT_OPEN' }
  | { outcome: 'QUOTA_FULL' };

export interface SurveyResponseRepositoryPort {
  /**
   * Finds all form IDs the given respondent has completed: a SUBMITTED or
   * VALIDATED Response OR a COMPLETED SurveyAttempt (External completions
   * create no Response; an Internal Response later DISPUTED/REJECTED keeps its
   * COMPLETED attempt). Mirrors participation's one-completion-per-form rule.
   */
  findCompletedFormIdsByRespondent(respondentId: string): Promise<Set<string>>;

  /**
   * Completed participations per form (quota, FR-38): SUBMITTED/VALIDATED
   * Responses plus COMPLETED attempts without a Response (External
   * completions). Mirrors participation's quota check.
   */
  getCompletedCountsByFormIds(formIds: string[]): Promise<Map<string, number>>;

  /**
   * Records a response entry (used for submission tracking and test simulation).
   */
  recordResponse(params: RecordResponseParams): Promise<void>;

  /**
   * Bug 3.3: creates an unauthenticated guest response (no escrow deducted,
   * no reward) only while the form is a PUBLISHED INTERNAL survey with quota
   * left, under the same form row lock (`FOR NO KEY UPDATE`) and quota
   * definition as participation's `reserveAttempt`: completed participations
   * (guests included) + unexpired IN_PROGRESS attempts must stay below
   * `expectedCompletions`. Replaces the unguarded `createGuestSubmission`.
   */
  createGuestResponseWithinQuota(
    params: CreateGuestResponseWithinQuotaParams,
  ): Promise<CreateGuestResponseWithinQuotaResult>;
}
