export class ParticipantNotEligibleException extends Error {
  readonly code = 'PARTICIPANT_NOT_ELIGIBLE';

  constructor(
    message = 'You do not meet the demographic targeting criteria for this survey.',
  ) {
    super(message);
    this.name = 'ParticipantNotEligibleException';
  }
}

export class SurveyAlreadyCompletedException extends Error {
  readonly code = 'SURVEY_ALREADY_COMPLETED';

  constructor(
    message = 'You have already completed this survey. Only one completion is allowed per participant.',
  ) {
    super(message);
    this.name = 'SurveyAlreadyCompletedException';
  }
}

export class SurveyQuotaFullException extends Error {
  readonly code = 'SURVEY_QUOTA_FULL';

  constructor(
    message = 'This survey has reached its maximum response quota or active reservation capacity.',
  ) {
    super(message);
    this.name = 'SurveyQuotaFullException';
  }
}

export class ConflictingActiveAttemptException extends Error {
  readonly code = 'CONFLICTING_ACTIVE_ATTEMPT';

  constructor(
    message = 'You already have an active survey attempt in progress. Please complete or wait for your active attempt to expire.',
  ) {
    super(message);
    this.name = 'ConflictingActiveAttemptException';
  }
}

export class SurveyNotAvailableException extends Error {
  readonly code = 'SURVEY_NOT_AVAILABLE';

  constructor(
    message = 'This survey is not currently published or available for participation.',
  ) {
    super(message);
    this.name = 'SurveyNotAvailableException';
  }
}
