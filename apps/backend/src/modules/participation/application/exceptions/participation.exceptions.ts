import {
  COMPLETION_CODE_LIMIT_REACHED_CODE,
  SELF_PARTICIPATION_FORBIDDEN_CODE,
} from '@rescom/schemas';
import type {
  CompletionCodeLimitDetails,
  ConflictingActiveAttemptDetails,
  ParticipationRateLimitDetails,
  TimeBarrierRejectionDetails,
} from '@rescom/schemas';

/**
 * Decision E4-DN2 (option A): the survey's Publisher cannot take it (no
 * self-payment from their own Escrow, no self-selected sample). 403.
 */
export class SelfParticipationForbiddenException extends Error {
  readonly code = SELF_PARTICIPATION_FORBIDDEN_CODE;

  constructor(
    message = 'You cannot take part in a survey you published. Use the preview instead.',
  ) {
    super(message);
    this.name = 'SelfParticipationForbiddenException';
  }
}

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
    /**
     * Epic 5 review P24: the caller's own unexpired attempt, so a client that
     * lost its tab can resume it instead of waiting for the expiry.
     */
    public readonly details?: ConflictingActiveAttemptDetails,
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

export class ResponseNotFoundException extends Error {
  readonly code = 'RESPONSE_NOT_FOUND';

  constructor(message = 'Survey response not found.') {
    super(message);
    this.name = 'ResponseNotFoundException';
  }
}

export class AttemptExpiredException extends Error {
  readonly code = 'ATTEMPT_EXPIRED';

  constructor(
    message = 'Survey attempt has expired or was abandoned. Please start a new attempt.',
  ) {
    super(message);
    this.name = 'AttemptExpiredException';
  }
}

export class InvalidFormSubmissionException extends Error {
  readonly code = 'INVALID_FORM_SUBMISSION';

  constructor(
    message = 'Form submission contains invalid or missing answers.',
    public readonly validationErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = 'InvalidFormSubmissionException';
  }
}

export class SubmissionTooFastException extends Error {
  readonly code = 'SUBMISSION_TOO_FAST';

  constructor(
    message = 'Submission was completed faster than the required minimum time barrier.',
    /** Story 8.2: required/elapsed/remaining seconds for the client countdown. */
    public readonly details?: TimeBarrierRejectionDetails,
  ) {
    super(message);
    this.name = 'SubmissionTooFastException';
  }

  get retryAfterSeconds(): number | undefined {
    return this.details?.retryAfterSeconds;
  }
}

/**
 * Story 8.2 (FR-46): the per-user participation rate limit was exceeded.
 * Nothing was consumed; the caller may retry after `retryAfterSeconds`.
 */
export class ParticipationRateLimitedException extends Error {
  readonly code = 'PARTICIPATION_RATE_LIMITED';

  constructor(
    public readonly details: ParticipationRateLimitDetails,
    message = details.scope !== 'COMPLETIONS'
      ? `Too many participation requests. Please try again in ${details.retryAfterSeconds} seconds.`
      : details.inProgressAttempts
        ? // Decision E8-D6: open attempts hold reserved capacity.
          `You have reached the limit of ${details.limit} surveys per ${Math.round(details.windowSeconds / 60)} minutes, counting completed surveys and the ${details.inProgressAttempts} survey(s) you still have in progress. Finish an open survey, or try again in ${details.retryAfterSeconds} seconds.`
        : `You have completed the maximum of ${details.limit} surveys allowed in ${Math.round(details.windowSeconds / 60)} minutes. Please try again in ${details.retryAfterSeconds} seconds.`,
  ) {
    super(message);
    this.name = 'ParticipationRateLimitedException';
  }

  get retryAfterSeconds(): number {
    return this.details.retryAfterSeconds;
  }
}

export class UncleanAttachmentException extends Error {
  readonly code = 'UNCLEAN_ATTACHMENT';

  constructor(
    message = 'Attached file has not passed malware scanning or was rejected.',
  ) {
    super(message);
    this.name = 'UncleanAttachmentException';
  }
}

export class InvalidCompletionCodeException extends Error {
  readonly code = 'INVALID_COMPLETION_CODE';

  constructor(
    public readonly remainingAttempts = 0,
    message = remainingAttempts > 0
      ? `Invalid completion code. ${remainingAttempts} attempts remaining before attempt is locked.`
      : 'Invalid completion code.',
  ) {
    super(message);
    this.name = 'InvalidCompletionCodeException';
  }
}

export class AttemptLockedException extends Error {
  readonly code = 'ATTEMPT_LOCKED';

  constructor(
    message = 'This survey attempt is locked due to too many failed completion code attempts.',
  ) {
    super(message);
    this.name = 'AttemptLockedException';
  }
}

/**
 * Decision E5-D1 (`completion-code-policy-v1`, provisional pending OQ14): the
 * account used every completion-code try on this FormVersion (6 wrong codes
 * across its attempts). Further attempts and verifications on the version are
 * refused until an Admin resets the count. 409.
 */
export class CompletionCodeLimitReachedException extends Error {
  readonly code = COMPLETION_CODE_LIMIT_REACHED_CODE;

  constructor(
    public readonly details: CompletionCodeLimitDetails,
    message = 'You have used every completion-code try for this survey version. Contact RESCOM support (Admin) if you believe this is a mistake.',
  ) {
    super(message);
    this.name = 'CompletionCodeLimitReachedException';
  }
}

/**
 * Epic 5 review P8/P14: a telemetry batch the attempt cannot accept (an
 * External attempt, events of another attempt/version/response, or a
 * timestamp outside the attempt's lifetime).
 */
export class TelemetryRejectedException extends Error {
  readonly code = 'TELEMETRY_REJECTED';

  constructor(message = 'Telemetry events were rejected for this attempt.') {
    super(message);
    this.name = 'TelemetryRejectedException';
  }
}

export class AttemptNotExternalException extends Error {
  readonly code = 'ATTEMPT_NOT_EXTERNAL';

  constructor(message = 'This survey attempt is not for an external survey.') {
    super(message);
    this.name = 'AttemptNotExternalException';
  }
}

/**
 * Epic 6 review P11: a Respondent-safe error when a survey's reward cannot be
 * paid (the Publisher's Escrow is short). It never carries the Publisher's
 * balances.
 */
export class SurveyRewardUnavailableException extends Error {
  readonly code = 'SURVEY_REWARD_UNAVAILABLE';

  constructor(
    message = 'The reward for this survey cannot be paid right now. Please try again later.',
  ) {
    super(message);
    this.name = 'SurveyRewardUnavailableException';
  }
}

/**
 * Epic 6 review P1/P5: the Admin reward re-drive refused a response or
 * attempt that is not a rewardable completion.
 */
export class RewardNotSettleableException extends Error {
  readonly code = 'REWARD_NOT_SETTLEABLE';

  constructor(message = 'This completion has no reward to settle.') {
    super(message);
    this.name = 'RewardNotSettleableException';
  }
}
