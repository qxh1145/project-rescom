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
   * Finds all form IDs that the given respondent has completed (SUBMITTED or VALIDATED).
   */
  findCompletedFormIdsByRespondent(respondentId: string): Promise<Set<string>>;

  /**
   * Aggregates completed response count (SUBMITTED or VALIDATED) for the given form IDs.
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
