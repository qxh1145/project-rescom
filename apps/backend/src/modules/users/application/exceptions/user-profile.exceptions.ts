/**
 * Invalid FR-9 profile input found by `UserProfileService` (Story IR.4b
 * part A): a birth year whose age falls outside 13..100 for the clock's year,
 * or input from a caller that skipped the HTTP validation pipe (the seed).
 * Mapped to 400 `VALIDATION_ERROR` with zod `format()` details, the same
 * answer as `ZodValidationPipe`.
 */
export class UserProfileValidationException extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(
    message: string,
    public readonly details: unknown,
  ) {
    super(message);
    this.name = 'UserProfileValidationException';
    Object.setPrototypeOf(this, UserProfileValidationException.prototype);
  }
}
