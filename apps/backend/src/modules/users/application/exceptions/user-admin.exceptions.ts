export class UserNotFoundException extends Error {
  readonly code = 'USER_NOT_FOUND';

  constructor(message = 'User not found.') {
    super(message);
    this.name = 'UserNotFoundException';
    Object.setPrototypeOf(this, UserNotFoundException.prototype);
  }
}

export class CannotLockSelfException extends Error {
  readonly code = 'CANNOT_LOCK_SELF';

  constructor(message = 'Admins cannot lock their own account.') {
    super(message);
    this.name = 'CannotLockSelfException';
    Object.setPrototypeOf(this, CannotLockSelfException.prototype);
  }
}

export class CannotLockLastAdminException extends Error {
  readonly code = 'CANNOT_LOCK_LAST_ADMIN';

  constructor(
    message = 'Cannot lock the sole remaining active admin account.',
  ) {
    super(message);
    this.name = 'CannotLockLastAdminException';
    Object.setPrototypeOf(this, CannotLockLastAdminException.prototype);
  }
}

export class CannotDemoteSelfException extends Error {
  readonly code = 'CANNOT_DEMOTE_SELF';

  constructor(message = 'Admins cannot demote or alter their own admin role.') {
    super(message);
    this.name = 'CannotDemoteSelfException';
    Object.setPrototypeOf(this, CannotDemoteSelfException.prototype);
  }
}

export class CannotDemoteLastAdminException extends Error {
  readonly code = 'CANNOT_DEMOTE_LAST_ADMIN';

  constructor(message = 'Cannot demote the sole remaining admin account.') {
    super(message);
    this.name = 'CannotDemoteLastAdminException';
    Object.setPrototypeOf(this, CannotDemoteLastAdminException.prototype);
  }
}

export class UserAdminActorNotActiveAdminException extends Error {
  readonly code = 'USER_ADMIN_ACTOR_NOT_ACTIVE_ADMIN';

  constructor(
    message = 'Acting user is no longer an active admin and cannot perform this action.',
  ) {
    super(message);
    this.name = 'UserAdminActorNotActiveAdminException';
    Object.setPrototypeOf(
      this,
      UserAdminActorNotActiveAdminException.prototype,
    );
  }
}
