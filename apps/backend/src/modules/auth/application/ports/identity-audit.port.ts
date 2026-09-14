export type IdentityAuditAction =
  | 'OAUTH_INTENT_REJECTED'
  | 'OAUTH_INTENT_REPLAYED'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'SESSION_REPLACED'
  | 'REFRESH_ROTATED'
  | 'REFRESH_REUSE_REVOKED'
  | 'LOGOUT'
  | 'IDENTITY_LINKED'
  | 'IDENTITY_UNLINKED'
  | 'USER_STATUS_CHANGED'
  | 'USER_ROLE_CHANGED';

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
