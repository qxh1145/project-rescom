import {
  SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE,
  SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE,
  SURVEY_FEEDBACK_NOT_ALLOWED_CODE,
} from '@rescom/schemas';

/**
 * Story 9.2: the attempt does not exist, is a guest attempt, or belongs to
 * another user. One error for all three so attempt ids cannot be probed (404).
 */
export class SurveyFeedbackAttemptNotFoundException extends Error {
  readonly code = SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE;

  constructor(message = 'Survey attempt not found.') {
    super(message);
    this.name = 'SurveyFeedbackAttemptNotFoundException';
  }
}

/**
 * Story 9.2: only a COMPLETED attempt (Internal: VALIDATED Response) can be
 * rated (409).
 */
export class SurveyFeedbackNotAllowedException extends Error {
  readonly code = SURVEY_FEEDBACK_NOT_ALLOWED_CODE;

  constructor(
    message = 'Feedback can only be given for a survey you have successfully completed.',
  ) {
    super(message);
    this.name = 'SurveyFeedbackNotAllowedException';
  }
}

/**
 * Story 9.2: one feedback per attempt; a different second submission is a
 * conflict (an identical one is replayed instead) (409).
 */
export class SurveyFeedbackAlreadySubmittedException extends Error {
  readonly code = SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE;

  constructor(
    message = 'Feedback for this survey attempt has already been submitted and cannot be changed.',
  ) {
    super(message);
    this.name = 'SurveyFeedbackAlreadySubmittedException';
  }
}
