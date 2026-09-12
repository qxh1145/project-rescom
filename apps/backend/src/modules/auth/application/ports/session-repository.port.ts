import {
  Session,
  SessionProps,
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

  revokeSession(
    sessionId: string,
    auditRecord?: CreateIdentityAuditRecord,
  ): Promise<void>;

  updateCsrfDigest(sessionId: string, newCsrfDigest: string): Promise<void>;
}

export const SESSION_REPOSITORY_PORT = Symbol('SessionRepositoryPort');
