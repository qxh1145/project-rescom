import {
  SessionRepositoryPort,
  ReplaceUserSessionInput,
} from '../application/ports/session-repository.port';
import {
  Session,
  SessionProps,
  RefreshCredential,
  RefreshCredentialProps,
} from '../domain/session.entity';
import {
  CreateIdentityAuditRecord,
  IdentityAuditPort,
} from '../application/ports/identity-audit.port';
import { InvalidRefreshTokenException } from '../application/exceptions/auth.exceptions';

export class InMemorySessionRepository implements SessionRepositoryPort {
  private sessions = new Map<string, SessionProps>();
  private credentials = new Map<string, RefreshCredentialProps>();
  private userLocks = new Map<string, Promise<void>>();

  constructor(private readonly auditPort?: IdentityAuditPort) {}

  async replaceUserSession(
    userId: string,
    input: ReplaceUserSessionInput,
  ): Promise<Session> {
    // Acquire per-user lock for serialized execution via strict FIFO promise chaining
    const prevLock = this.userLocks.get(userId) || Promise.resolve();
    let resolveLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.userLocks.set(
      userId,
      prevLock.then(
        () => lockPromise,
        () => lockPromise,
      ),
    );

    await prevLock;

    try {
      // 1. Calculate next version as max of all historical versions for user + 1
      let maxVersion = 0;
      for (const session of this.sessions.values()) {
        if (session.userId === userId && session.sessionVersion > maxVersion) {
          maxVersion = session.sessionVersion;
        }
      }
      const nextVersion = maxVersion + 1;

      // 2. Single active session enforcement: revoke previous active sessions
      for (const session of this.sessions.values()) {
        if (session.userId === userId && !session.revoked) {
          this.sessions.set(session.id, { ...session, revoked: true });
        }
      }

      // 3. Create new SessionProps with nextVersion
      const createdSessionProps: SessionProps = {
        ...input.session,
        sessionVersion: nextVersion,
      };
      this.sessions.set(createdSessionProps.id, createdSessionProps);

      // 4. Create RefreshCredential
      this.credentials.set(input.credential.id, { ...input.credential });

      // 5. Append IdentityAuditLog if auditPort configured
      if (this.auditPort) {
        await this.auditPort.append({
          ...input.audit,
          metadata: {
            ...(input.audit.metadata ?? {}),
            sessionId: createdSessionProps.id,
            sessionVersion: nextVersion,
          },
        });
      }

      return new Session(createdSessionProps);
    } finally {
      resolveLock();
      if (this.userLocks.get(userId) === lockPromise) {
        this.userLocks.delete(userId);
      }
    }
  }

  async findById(sessionId: string): Promise<Session | null> {
    const s = this.sessions.get(sessionId);
    return s ? new Session(s) : null;
  }

  async findActiveByUserId(userId: string): Promise<Session | null> {
    const now = new Date();
    for (const session of this.sessions.values()) {
      if (
        session.userId === userId &&
        !session.revoked &&
        session.expiresAt > now
      ) {
        return new Session(session);
      }
    }
    return null;
  }

  async findCredentialWithSession(
    credentialId: string,
  ): Promise<{ credential: RefreshCredential; session: Session } | null> {
    const c = this.credentials.get(credentialId);
    if (!c) return null;
    const s = this.sessions.get(c.sessionId);
    if (!s) return null;
    return {
      credential: new RefreshCredential(c),
      session: new Session(s),
    };
  }

  async rotateRefreshCredential(
    currentCredentialId: string,
    newCredential: RefreshCredentialProps,
    newCsrfDigest: string,
    auditRecord: CreateIdentityAuditRecord,
  ): Promise<void> {
    const current = this.credentials.get(currentCredentialId);
    if (!current || current.isUsed) {
      throw new InvalidRefreshTokenException();
    }
    this.credentials.set(currentCredentialId, {
      ...current,
      isUsed: true,
      usedAt: new Date(),
    });
    this.credentials.set(newCredential.id, newCredential);
    const session = this.sessions.get(newCredential.sessionId);
    if (session) {
      this.sessions.set(session.id, {
        ...session,
        csrfDigest: newCsrfDigest,
      });
    }
    if (this.auditPort) {
      await this.auditPort.append(auditRecord);
    }
  }

  async revokeSession(
    sessionId: string,
    auditRecord?: CreateIdentityAuditRecord,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, revoked: true });
    }
    if (auditRecord && this.auditPort) {
      await this.auditPort.append(auditRecord);
    }
  }

  async revokeAllByUserId(userId: string): Promise<void> {
    for (const [id, session] of this.sessions.entries()) {
      if (session.userId === userId && !session.revoked) {
        this.sessions.set(id, { ...session, revoked: true });
      }
    }
  }

  async updateCsrfDigest(
    sessionId: string,
    newCsrfDigest: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, {
        ...session,
        csrfDigest: newCsrfDigest,
      });
    }
  }

  snapshot(): {
    sessions: SessionProps[];
    credentials: RefreshCredentialProps[];
  } {
    return {
      sessions: Array.from(this.sessions.values(), (session) => ({
        ...session,
      })),
      credentials: Array.from(this.credentials.values(), (credential) => ({
        ...credential,
      })),
    };
  }

  restore(snapshot: {
    sessions: readonly SessionProps[];
    credentials: readonly RefreshCredentialProps[];
  }): void {
    this.sessions = new Map(
      snapshot.sessions.map((session) => [session.id, { ...session }]),
    );
    this.credentials = new Map(
      snapshot.credentials.map((credential) => [
        credential.id,
        { ...credential },
      ]),
    );
  }

  clear(): void {
    this.sessions.clear();
    this.credentials.clear();
  }
}
