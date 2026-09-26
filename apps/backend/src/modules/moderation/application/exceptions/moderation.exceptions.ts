/** 400 — the moderation command body is invalid. */
export class InvalidModerationRequestException extends Error {
  readonly code = 'MODERATION_INVALID_REQUEST';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidModerationRequestException';
  }
}

/** 403 — the actor is no longer an ACTIVE ADMIN (live Identity check, AD-16). */
export class ModerationAdminCapabilityRequiredException extends Error {
  readonly code = 'MODERATION_ADMIN_CAPABILITY_REQUIRED';

  constructor() {
    super('An active administrator account is required to moderate surveys.');
    this.name = 'ModerationAdminCapabilityRequiredException';
  }
}

/** 403 — an Admin cannot moderate a survey they published themselves. */
export class ModerationSelfReviewForbiddenException extends Error {
  readonly code = 'MODERATION_SELF_REVIEW_FORBIDDEN';

  constructor() {
    super('Administrators cannot moderate their own surveys.');
    this.name = 'ModerationSelfReviewForbiddenException';
  }
}

/** 409 — the survey is not waiting in the moderation queue. */
export class FormNotInModerationQueueException extends Error {
  readonly code = 'FORM_NOT_IN_MODERATION_QUEUE';

  constructor(formId: string, status: string) {
    super(
      `Survey "${formId}" is not awaiting moderation (current status: ${status}).`,
    );
    this.name = 'FormNotInModerationQueueException';
  }
}

/** 409 — the queued version differs from the version the Admin previewed. */
export class ModerationVersionMismatchException extends Error {
  readonly code = 'MODERATION_VERSION_MISMATCH';

  constructor(formId: string) {
    super(
      `The version of survey "${formId}" awaiting moderation changed. Reload the preview and decide again.`,
    );
    this.name = 'ModerationVersionMismatchException';
  }
}

/** 409 — the version already has the opposite moderation decision. */
export class ModerationAlreadyDecidedException extends Error {
  readonly code = 'MODERATION_ALREADY_DECIDED';

  constructor(formId: string, outcome: string) {
    super(`Survey "${formId}" was already moderated (${outcome}).`);
    this.name = 'ModerationAlreadyDecidedException';
  }
}
