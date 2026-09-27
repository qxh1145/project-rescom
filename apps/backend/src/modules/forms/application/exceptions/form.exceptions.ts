import type { FormCloseKind } from '@rescom/schemas';

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
  constructor(
    message: string,
    public readonly errors: any[] = [],
    /** Machine-readable code; specific pre-publish rules use their own. */
    readonly code: string = 'FORM_VALIDATION_ERROR',
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
 * Decision D2 (Bug 3.1): once any version of a survey was published, its
 * pricing is frozen — a re-versioned draft may not change the survey type or
 * the reward per response, because the Escrow held for the live quota and the
 * rewards already promised were priced with them. Maps to HTTP 409 Conflict
 * with `details: { fields }`.
 */
export class FormPublishedFieldsImmutableException extends Error {
  readonly code = 'FORM_PUBLISHED_FIELDS_IMMUTABLE';

  constructor(
    id: string,
    readonly fields: string[],
  ) {
    super(
      `Form "${id}" has a published version: ${fields.join(', ')} cannot be changed after the first publication.`,
    );
    this.name = 'FormPublishedFieldsImmutableException';
  }
}

/**
 * Bug 3.4: the completion code of a survey waiting in `MODERATION_QUEUE`
 * cannot be rotated — rotation creates a new version and the Admin's pending
 * decision is pinned to the queued one. Maps to HTTP 409 Conflict.
 */
export class FormInModerationException extends Error {
  readonly code = 'FORM_IN_MODERATION';

  constructor(id: string) {
    super(
      `Form "${id}" is awaiting moderation; its completion code can be rotated after the moderation decision.`,
    );
    this.name = 'FormInModerationException';
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

/**
 * CAPTCHA failure reason of a server without a CAPTCHA provider: a server
 * misconfiguration, not a client error (review F6).
 */
export const CAPTCHA_PROVIDER_NOT_CONFIGURED =
  'CAPTCHA_PROVIDER_NOT_CONFIGURED';

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

  constructor(
    message: string,
    /** Bug 3.3: per-block validation errors (block id -> message). */
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'InvalidGuestSubmissionException';
  }
}

/**
 * Story 8.1: a form waiting in `MODERATION_QUEUE` can only leave the queue
 * through the Admin moderation workflow (approve / reject), never through the
 * generic status endpoint or another user's `POST /forms/:id/close` (Epic 8
 * review P1; the owner may still withdraw it). Maps to HTTP 409 Conflict.
 */
export class FormModerationRequiredException extends Error {
  readonly code = 'FORM_MODERATION_REQUIRED';

  constructor(id: string) {
    super(
      `Form "${id}" is awaiting moderation. Approve or reject it through the moderation queue.`,
    );
    this.name = 'FormModerationRequiredException';
  }
}

/**
 * Why a closed survey cannot be reopened:
 * - `CLOSED_BY_ADMIN_OR_MODERATION` (decision E8-D1): only the owner's own
 *   close can be reopened; an Admin takedown, a moderation rejection or a
 *   close recorded before the close kind existed is final.
 * - `VERSION_NOT_APPROVED` (Story 8.1): the current version never went live
 *   (a withdrawn submission cannot be put live by reopening it).
 */
export type FormNotReopenableReason =
  'CLOSED_BY_ADMIN_OR_MODERATION' | 'VERSION_NOT_APPROVED';

/**
 * Story 8.1 / decision E8-D1: the survey cannot be reopened with additional
 * quota. Maps to HTTP 409 Conflict with `details: { reason, closeKind }`.
 */
export class FormNotReopenableException extends Error {
  readonly code = 'FORM_NOT_REOPENABLE';
  readonly reason: FormNotReopenableReason;
  readonly closeKind: FormCloseKind | null;

  constructor(
    id: string,
    options: {
      reason?: FormNotReopenableReason;
      closeKind?: FormCloseKind | null;
    } = {},
  ) {
    const reason = options.reason ?? 'VERSION_NOT_APPROVED';
    super(
      reason === 'CLOSED_BY_ADMIN_OR_MODERATION'
        ? `Form "${id}" cannot be reopened: it was closed by an Admin or rejected by moderation, which is final. Only a survey its owner closed can be reopened.`
        : `Form "${id}" cannot be reopened because its current version was never approved for the Marketplace.`,
    );
    this.name = 'FormNotReopenableException';
    this.reason = reason;
    this.closeKind = options.closeKind ?? null;
  }
}

/**
 * Epic 8 review P2: a survey enters the moderation queue or is approved only
 * when the Escrow for its open quota is fully reserved (FR-15). An Admin never
 * reserves on the Publisher's behalf: an unfunded (legacy) survey is rejected
 * or closed instead, which refunds whatever it holds. Maps to HTTP 409
 * Conflict with `details.shortfall`.
 */
export class ModerationEscrowNotFundedException extends Error {
  readonly code = 'MODERATION_ESCROW_NOT_FUNDED';

  constructor(
    readonly formId: string,
    readonly shortfall: number,
  ) {
    super(
      `Form "${formId}" is not fully funded: ${shortfall} Escrow points are missing. Reject or close it instead; the Escrow it holds is refunded.`,
    );
    this.name = 'ModerationEscrowNotFundedException';
  }
}

/**
 * Story 6.3 AC1.2 / decision E6-D2: the reward per response is outside the
 * FR-14 pricing band of the survey's estimated duration when it is published
 * (both the band minimum and maximum apply; drafts are never checked).
 * Maps to HTTP 400 with `details: { min, max, suggested }`.
 */
export class PricingRewardOutOfBandException extends Error {
  readonly code = 'PRICING_REWARD_OUT_OF_BAND';

  constructor(
    public readonly rewardPerResponse: number,
    public readonly band: { min: number; max: number; suggested: number },
    durationBand: string,
  ) {
    super(
      `A reward of ${rewardPerResponse} points per response is outside the ${band.min}–${band.max} point pricing band for surveys of ${durationBand}. Suggested reward: ${band.suggested} points.`,
    );
    this.name = 'PricingRewardOutOfBandException';
  }
}

/**
 * Phase 5 C6: another form of the same Publisher already carries this
 * `Idempotency-Key` (unique constraint hit by a concurrent request). The
 * service converges on that form; never mapped to HTTP directly.
 */
export class FormCreationKeyTakenException extends Error {
  readonly code = 'FORM_CREATION_KEY_TAKEN';

  constructor(readonly key: string) {
    super(`A form was already created with this Idempotency-Key.`);
    this.name = 'FormCreationKeyTakenException';
  }
}

/** Why an `Idempotency-Key` cannot replay the survey it created. */
export type IdempotencyKeyConflictReason =
  'DIFFERENT_REQUEST' | 'SURVEY_CHANGED';

/**
 * Phase 5 C6: `POST /forms/external` reused an `Idempotency-Key` with a
 * different request body (`DIFFERENT_REQUEST`), or the survey it created has
 * since moved to another version, so its one-time completion code can no
 * longer be replayed (`SURVEY_CHANGED`). Maps to HTTP 409 with
 * `details: { reason, formId }`.
 */
export class IdempotencyKeyConflictException extends Error {
  readonly code = 'IDEMPOTENCY_KEY_CONFLICT';

  constructor(
    readonly reason: IdempotencyKeyConflictReason,
    readonly formId: string,
  ) {
    super(
      reason === 'DIFFERENT_REQUEST'
        ? 'This Idempotency-Key was already used with a different request body.'
        : 'The survey created with this Idempotency-Key has changed since; its creation response can no longer be replayed.',
    );
    this.name = 'IdempotencyKeyConflictException';
  }
}
