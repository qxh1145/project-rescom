export class EmailAlreadyRegisteredException extends Error {
  readonly code = 'AUTH_EMAIL_ALREADY_REGISTERED';

  constructor(message = 'An account with this email already exists.') {
    super(message);
    this.name = 'EmailAlreadyRegisteredException';
    Object.setPrototypeOf(this, EmailAlreadyRegisteredException.prototype);
  }
}

export class InvalidCredentialsException extends Error {
  readonly code = 'AUTH_INVALID_CREDENTIALS';

  constructor(message = 'Invalid email or password.') {
    super(message);
    this.name = 'InvalidCredentialsException';
    Object.setPrototypeOf(this, InvalidCredentialsException.prototype);
  }
}

export class UnauthorizedSessionException extends Error {
  readonly code = 'AUTH_UNAUTHORIZED';

  constructor(message = 'Authentication required or session invalid.') {
    super(message);
    this.name = 'UnauthorizedSessionException';
    Object.setPrototypeOf(this, UnauthorizedSessionException.prototype);
  }
}

export class InvalidTokenException extends Error {
  readonly code = 'AUTH_INVALID_TOKEN';

  constructor(message = 'Invalid authentication token.') {
    super(message);
    this.name = 'InvalidTokenException';
    Object.setPrototypeOf(this, InvalidTokenException.prototype);
  }
}

export class SessionExpiredException extends Error {
  readonly code = 'AUTH_SESSION_EXPIRED';

  constructor(message = 'Session has expired.') {
    super(message);
    this.name = 'SessionExpiredException';
    Object.setPrototypeOf(this, SessionExpiredException.prototype);
  }
}

export class SessionRevokedException extends Error {
  readonly code = 'AUTH_SESSION_REVOKED';

  constructor(message = 'Session has been revoked.') {
    super(message);
    this.name = 'SessionRevokedException';
    Object.setPrototypeOf(this, SessionRevokedException.prototype);
  }
}

export class InvalidRefreshTokenException extends Error {
  readonly code = 'AUTH_INVALID_REFRESH_TOKEN';

  constructor(message = 'Refresh token is invalid or has been replayed.') {
    super(message);
    this.name = 'InvalidRefreshTokenException';
    Object.setPrototypeOf(this, InvalidRefreshTokenException.prototype);
  }
}

export class InvalidCsrfTokenException extends Error {
  readonly code = 'AUTH_INVALID_CSRF_TOKEN';

  constructor(message = 'Invalid or missing CSRF token.') {
    super(message);
    this.name = 'InvalidCsrfTokenException';
    Object.setPrototypeOf(this, InvalidCsrfTokenException.prototype);
  }
}

export class ForbiddenOriginException extends Error {
  readonly code = 'AUTH_FORBIDDEN_ORIGIN';

  constructor(message = 'Cross-origin request rejected.') {
    super(message);
    this.name = 'ForbiddenOriginException';
    Object.setPrototypeOf(this, ForbiddenOriginException.prototype);
  }
}

export class UserLockedException extends Error {
  readonly code = 'AUTH_USER_LOCKED';

  constructor(message = 'User account is locked.') {
    super(message);
    this.name = 'UserLockedException';
    Object.setPrototypeOf(this, UserLockedException.prototype);
  }
}

export class OAuthIntentInvalidException extends Error {
  readonly code = 'AUTH_INVALID_OAUTH_INTENT';

  constructor(
    message = 'OAuth intent is invalid, expired, or already consumed.',
  ) {
    super(message);
    this.name = 'OAuthIntentInvalidException';
    Object.setPrototypeOf(this, OAuthIntentInvalidException.prototype);
  }
}

export class GoogleAuthCancelledException extends Error {
  readonly code = 'GOOGLE_AUTH_CANCELLED';

  constructor(message = 'Google authorization was cancelled or denied.') {
    super(message);
    this.name = 'GoogleAuthCancelledException';
    Object.setPrototypeOf(this, GoogleAuthCancelledException.prototype);
  }
}

export class GoogleProviderUnavailableException extends Error {
  readonly code = 'AUTH_GOOGLE_PROVIDER_UNAVAILABLE';

  constructor(message = 'Google identity provider is currently unavailable.') {
    super(message);
    this.name = 'GoogleProviderUnavailableException';
    Object.setPrototypeOf(this, GoogleProviderUnavailableException.prototype);
  }
}

export class InvalidGoogleIdentityException extends Error {
  readonly code = 'AUTH_INVALID_GOOGLE_IDENTITY';

  constructor(message = 'Google identity claims are invalid or incomplete.') {
    super(message);
    this.name = 'InvalidGoogleIdentityException';
    Object.setPrototypeOf(this, InvalidGoogleIdentityException.prototype);
  }
}

export class GoogleLinkRequiredException extends Error {
  readonly code = 'AUTH_GOOGLE_LINK_REQUIRED';

  constructor(
    message = 'An account with this email already exists. Please log in with password and link Google in settings.',
  ) {
    super(message);
    this.name = 'GoogleLinkRequiredException';
    Object.setPrototypeOf(this, GoogleLinkRequiredException.prototype);
  }
}

export class FinalLoginMethodException extends Error {
  readonly code = 'AUTH_FINAL_LOGIN_METHOD';

  constructor(message = 'Cannot remove final login method for account.') {
    super(message);
    this.name = 'FinalLoginMethodException';
    Object.setPrototypeOf(this, FinalLoginMethodException.prototype);
  }
}

export class GoogleIdentityConflictException extends Error {
  readonly code = 'AUTH_GOOGLE_IDENTITY_CONFLICT';

  constructor(message = 'Google account is already linked to another user.') {
    super(message);
    this.name = 'GoogleIdentityConflictException';
    Object.setPrototypeOf(this, GoogleIdentityConflictException.prototype);
  }
}
