export class FormNotFoundException extends Error {
  readonly code = 'FORM_NOT_FOUND';

  constructor(id: string) {
    super(`Form with ID "${id}" was not found.`);
    this.name = 'FormNotFoundException';
  }
}

export class FormForbiddenException extends Error {
  readonly code = 'FORM_FORBIDDEN';

  constructor(
    message = 'You do not have permission to access or modify this form.',
  ) {
    super(message);
    this.name = 'FormForbiddenException';
  }
}

export class FormNotInDraftStatusException extends Error {
  readonly code = 'FORM_NOT_IN_DRAFT_STATUS';

  constructor(status: string) {
    super(
      `Form cannot be modified in "${status}" status. Only DRAFT forms can be edited or autosaved.`,
    );
    this.name = 'FormNotInDraftStatusException';
  }
}

export class InvalidFormDraftException extends Error {
  readonly code = 'INVALID_FORM_DRAFT';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidFormDraftException';
  }
}

/**
 * Thrown when an autosave write is rejected because the server's stored
 * `updatedAt` is strictly newer than the `clientUpdatedAt` the client sent.
 * This means another concurrent request already committed a later write, and
 * the client must refresh its local snapshot before retrying.
 *
 * Maps to HTTP 409 Conflict.
 */
export class FormConflictException extends Error {
  readonly code = 'FORM_EDIT_CONFLICT';

  constructor(
    formId: string,
    clientUpdatedAt: string,
    serverUpdatedAt: string,
  ) {
    super(
      `Autosave conflict on form "${formId}": ` +
        `client snapshot (${clientUpdatedAt}) is older than the server record (${serverUpdatedAt}). ` +
        `Reload the latest version and retry.`,
    );
    this.name = 'FormConflictException';
  }
}

export class InvalidFormStatusTransitionException extends Error {
  readonly code = 'INVALID_STATUS_TRANSITION';

  constructor(formId: string, fromStatus: string, toStatus: string) {
    super(
      `Cannot transition form "${formId}" from "${fromStatus}" to "${toStatus}". Illegal lifecycle transition.`,
    );
    this.name = 'InvalidFormStatusTransitionException';
  }
}

export class FormValidationException extends Error {
  readonly code = 'FORM_VALIDATION_ERROR';

  constructor(
    message: string,
    public readonly errors: any[] = [],
  ) {
    super(message);
    this.name = 'FormValidationException';
  }
}

export class FormAlreadyPublishedException extends Error {
  readonly code = 'FORM_ALREADY_PUBLISHED';

  constructor(id: string) {
    super(`Form with ID "${id}" has already been published.`);
    this.name = 'FormAlreadyPublishedException';
  }
}

export class FormAlreadyClosedException extends Error {
  readonly code = 'FORM_ALREADY_CLOSED';

  constructor(id: string) {
    super(`Form with ID "${id}" is already closed.`);
    this.name = 'FormAlreadyClosedException';
  }
}

export class FormNotPublishedException extends Error {
  readonly code = 'FORM_NOT_PUBLISHED';

  constructor(id: string, status: string) {
    super(
      `Cannot create a new version of form "${id}": form must be in PUBLISHED status, but current status is "${status}".`,
    );
    this.name = 'FormNotPublishedException';
  }
}

export class FormHasPublishedVersionsException extends Error {
  readonly code = 'FORM_HAS_PUBLISHED_VERSIONS';

  constructor(id: string) {
    super(
      `Form with ID "${id}" cannot be deleted because it has published version history.`,
    );
    this.name = 'FormHasPublishedVersionsException';
  }
}

/**
 * Thrown when targeting criteria in a PATCH /forms/:id/draft request fails
 * `surveyTargetingSchema` validation (e.g. ageRange.min > ageRange.max,
 * invalid gender enum value, location array too large).
 *
 * Maps to HTTP 422 Unprocessable Entity.
 */
export class TargetingValidationException extends Error {
  readonly code = 'TARGETING_VALIDATION_ERROR';

  constructor(
    details: string,
    public readonly issues: any[] = [],
  ) {
    super(`Invalid survey targeting criteria: ${details}`);
    this.name = 'TargetingValidationException';
  }
}

export class PublicFormAccessDisabledException extends Error {
  readonly code = 'PUBLIC_ACCESS_DISABLED';

  constructor(
    message = 'PUBLIC_ACCESS_DISABLED: Public access to this form is disabled or requires authentication.',
  ) {
    super(message);
    this.name = 'PublicFormAccessDisabledException';
  }
}

export class CaptchaVerificationFailedException extends Error {
  readonly code = 'CAPTCHA_VERIFICATION_FAILED';

  constructor(message = 'CAPTCHA_VERIFICATION_FAILED') {
    super(message);
    this.name = 'CaptchaVerificationFailedException';
  }
}

export class GuestRateLimitExceededException extends Error {
  readonly code = 'GUEST_RATE_LIMIT_EXCEEDED';

  constructor(
    message = 'GUEST_RATE_LIMIT_EXCEEDED: Maximum 3 guest submissions per 24 hours allowed from this IP',
  ) {
    super(message);
    this.name = 'GuestRateLimitExceededException';
  }
}

export class InvalidGuestSubmissionException extends Error {
  readonly code = 'BAD_REQUEST';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidGuestSubmissionException';
  }
}
