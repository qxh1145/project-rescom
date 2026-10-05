import {
  Session,
  SessionProps,
  SessionRevokeReason,
  RefreshCredential,
  RefreshCredentialProps,
} from '../../domain/session.entity';
import { CreateIdentityAuditRecord } from './identity-audit.port';

export interface ReplaceUserSessionInput {
  session: Omit<SessionProps, 'sessionVersion'>;
  credential: RefreshCredentialProps;
  audit: CreateIdentityAuditRecord;
}

export interface SessionRepositoryPort {
  /** Revokes the account's other active sessions with reason `REPLACED` (plan 5.6). */
  replaceUserSession(
    userId: string,
    input: ReplaceUserSessionInput,
  ): Promise<Session>;

  findById(sessionId: string): Promise<Session | null>;

  findCredentialWithSession(
    credentialId: string,
  ): Promise<{ credential: RefreshCredential; session: Session } | null>;

  rotateRefreshCredential(
    currentCredentialId: string,
    newCredential: RefreshCredentialProps,
    newCsrfDigest: string,
    auditRecord: CreateIdentityAuditRecord,
  ): Promise<void>;

  /** Plan 5.6: records `revokedAt` and `reason` with the revocation. */
  revokeSession(
    sessionId: string,
    reason: SessionRevokeReason,
    auditRecord?: CreateIdentityAuditRecord,
  ): Promise<void>;

  revokeAllByUserId(userId: string, reason: SessionRevokeReason): Promise<void>;

  updateCsrfDigest(sessionId: string, newCsrfDigest: string): Promise<void>;
}

export const SESSION_REPOSITORY_PORT = Symbol('SessionRepositoryPort');
