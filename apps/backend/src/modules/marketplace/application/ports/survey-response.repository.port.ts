export const SURVEY_RESPONSE_REPOSITORY_PORT = Symbol(
  'SURVEY_RESPONSE_REPOSITORY_PORT',
);

export type SurveyResponseStatus =
  'IN_PROGRESS' | 'SUBMITTED' | 'VALIDATED' | 'DISPUTED' | 'REJECTED';

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
   * Creates an unauthenticated guest response and associated integrity assessment record.
   * Does NOT deduct escrow points or award any points.
   */
  createGuestSubmission(
    params: CreateGuestSubmissionParams,
  ): Promise<GuestSubmissionEntity>;
}
