export type IdentityAuditAction =
  | 'OAUTH_INTENT_REJECTED'
  | 'OAUTH_INTENT_REPLAYED'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'SESSION_REPLACED'
  | 'REFRESH_ROTATED'
  | 'REFRESH_REUSE_SUSPECTED'
  | 'REFRESH_REUSE_REVOKED'
  | 'LOGOUT'
  | 'IDENTITY_LINKED'
  | 'IDENTITY_UNLINKED'
  | 'USER_STATUS_CHANGED'
  | 'USER_ROLE_CHANGED'
  // Story IR.2b Task 4.7: an Admin re-drove a dead-lettered Outbox event.
  | 'OUTBOX_EVENT_REDRIVEN'
  // Plan 5.4: a reset link was issued / redeemed (password changed).
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED';

export interface CreateIdentityAuditRecord {
  action: IdentityAuditAction;
  userId?: string | null;
  targetUserId?: string | null;
  outcome: 'SUCCESS' | 'FAILURE';
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface IdentityAuditPort {
  append(record: CreateIdentityAuditRecord): Promise<void>;
}

export const IDENTITY_AUDIT_PORT = Symbol('IdentityAuditPort');
