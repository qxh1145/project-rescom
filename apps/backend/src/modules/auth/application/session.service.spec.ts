import { SessionService } from './session.service';
import {
  SessionRepositoryPort,
  ReplaceUserSessionInput,
} from './ports/session-repository.port';
import { UserRepositoryPort } from '../../users/application/ports/user.repository.port';
import {
  TokenServicePort,
  AccessTokenClaims,
} from './ports/token-service.port';
import { SecretProtectionPort } from './ports/secret-protection.port';
import {
  IdentityAuditPort,
  CreateIdentityAuditRecord,
} from './ports/identity-audit.port';
import { User } from '../../users/domain/user.entity';
import {
  Session,
  SessionProps,
  RefreshCredential,
  RefreshCredentialProps,
} from '../domain/session.entity';
import {
  UnauthorizedSessionException,
  SessionExpiredException,
  SessionRevokedException,
  InvalidRefreshTokenException,
  InvalidCsrfTokenException,
  UserLockedException,
} from './exceptions/auth.exceptions';

describe('SessionService (Task 1: Identity Session Foundation)', () => {
  let sessionService: SessionService;
  let sessionRepo: MockSessionRepository;
  let userRepo: MockUserRepository;
  let tokenService: MockTokenService;
  let secretProtection: MockSecretProtection;
  let auditPort: MockAuditPort;

  class MockSessionRepository implements SessionRepositoryPort {
    sessions = new Map<string, SessionProps>();
    credentials = new Map<string, RefreshCredentialProps>();

    async replaceUserSession(
      userId: string,
      input: ReplaceUserSessionInput,
    ): Promise<Session> {
      let maxVersion = 0;
      for (const s of this.sessions.values()) {
        if (s.userId === userId && s.sessionVersion > maxVersion) {
          maxVersion = s.sessionVersion;
        }
      }
      const nextVersion = maxVersion + 1;

      // Revoke any existing active session for this user
      for (const [id, s] of this.sessions.entries()) {
        if (s.userId === userId && !s.revoked) {
          this.sessions.set(id, { ...s, revoked: true });
        }
      }
      const sessionProps: SessionProps = {
        ...input.session,
        sessionVersion: nextVersion,
      };
      this.sessions.set(sessionProps.id, sessionProps);
      this.credentials.set(input.credential.id, input.credential);
      return new Session(sessionProps);
    }

    async findById(sessionId: string): Promise<Session | null> {
      const s = this.sessions.get(sessionId);
      return s ? new Session(s) : null;
    }

    async findCredentialWithSession(
      credentialId: string,
    ): Promise<{ credential: RefreshCredential; session: Session } | null> {
      const c = this.credentials.get(credentialId);
      if (!c) return null;
      const s = this.sessions.get(c.sessionId);
      if (!s) return null;
      return { credential: new RefreshCredential(c), session: new Session(s) };
    }

    async rotateRefreshCredential(
      currentCredentialId: string,
      newCredential: RefreshCredentialProps,
      newCsrfDigest: string,
      _auditRecord: CreateIdentityAuditRecord,
    ): Promise<void> {
      const current = this.credentials.get(currentCredentialId);
      if (current) {
        this.credentials.set(currentCredentialId, {
          ...current,
          isUsed: true,
          usedAt: new Date(),
        });
      }
      this.credentials.set(newCredential.id, newCredential);
      const session = this.sessions.get(newCredential.sessionId);
      if (session) {
        this.sessions.set(session.id, {
          ...session,
          csrfDigest: newCsrfDigest,
        });
      }
    }

    async revokeSession(
      sessionId: string,
      auditRecord?: CreateIdentityAuditRecord,
    ): Promise<void> {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.sessions.set(sessionId, { ...session, revoked: true });
        if (auditRecord) {
          auditPort.append(auditRecord);
        }
      }
    }

    async revokeAllByUserId(userId: string): Promise<void> {
      for (const [id, s] of this.sessions.entries()) {
        if (s.userId === userId && !s.revoked) {
          this.sessions.set(id, { ...s, revoked: true });
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
  }

  class MockUserRepository implements UserRepositoryPort {
    users = new Map<string, User>();

    async create(user: any): Promise<User> {
      const u = new User(user);
      this.users.set(u.id, u);
      return u;
    }

    async findByEmail(email: string): Promise<User | null> {
      for (const u of this.users.values()) {
        if (u.email === email) return u;
      }
      return null;
    }

    async findById(id: string): Promise<User | null> {
      return this.users.get(id) ?? null;
    }

    async findMany(): Promise<any> {
      return { users: Array.from(this.users.values()), total: this.users.size };
    }

    async countByRoleAndStatus(role: any, status: any): Promise<number> {
      let count = 0;
      for (const u of this.users.values()) {
        if (u.role === role && u.status === status) count++;
      }
      return count;
    }
  }

  class MockTokenService implements TokenServicePort {
    validTokens = new Map<string, AccessTokenClaims>();

    async signToken(payload: AccessTokenClaims): Promise<string> {
      const token = `jwt.${payload.sessionId}.${payload.sub}.${payload.sessionVersion}`;
      this.validTokens.set(token, payload);
      return token;
    }

    async verifyToken(token: string): Promise<AccessTokenClaims> {
      const claims = this.validTokens.get(token);
      if (!claims) {
        throw new UnauthorizedSessionException('Invalid JWT');
      }
      return claims;
    }
  }

  class MockSecretProtection implements SecretProtectionPort {
    hashRefreshSecret(secret: string): string {
      return `digest:${secret}`;
    }
    verifyRefreshSecret(secret: string, digest: string): boolean {
      return digest === `digest:${secret}`;
    }
    hashCsrfToken(token: string): string {
      return `csrf-digest:${token}`;
    }
    verifyCsrfToken(token: string, digest: string): boolean {
      return digest === `csrf-digest:${token}`;
    }
    hashOAuthSecret(secret: string): string {
      return `oauth-digest:${secret}`;
    }
    verifyOAuthSecret(secret: string, digest: string): boolean {
      return digest === `oauth-digest:${secret}`;
    }
    encryptPkceVerifier(verifier: string): string {
      return `enc:${verifier}`;
    }
    decryptPkceVerifier(encrypted: string): string {
      return encrypted.replace(/^enc:/, '');
    }
  }

  class MockAuditPort implements IdentityAuditPort {
    records: CreateIdentityAuditRecord[] = [];
    async append(record: CreateIdentityAuditRecord): Promise<void> {
      this.records.push(record);
    }
  }

  beforeEach(() => {
    sessionRepo = new MockSessionRepository();
    userRepo = new MockUserRepository();
    tokenService = new MockTokenService();
    secretProtection = new MockSecretProtection();
    auditPort = new MockAuditPort();

    sessionService = new SessionService(
      sessionRepo,
      userRepo,
      tokenService,
      secretProtection,
      auditPort,
      {
        jwtAccessTtlSeconds: 900,
        sessionAbsoluteTtlSeconds: 2592000,
      },
    );
  });

  describe('Single active Session replacement', () => {
    it('should create a new session and revoke any previous active session for the user', async () => {
      const user = await userRepo.create({
        id: 'user-1',
        email: 'user1@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const firstSession = await sessionService.createSession(user.id);
      expect(firstSession.accessToken).toBeDefined();
      expect(firstSession.refreshToken).toBeDefined();
      expect(firstSession.csrfToken).toBeDefined();

      const secondSession = await sessionService.createSession(user.id);
      expect(secondSession.accessToken).toBeDefined();
      expect(secondSession.accessToken).not.toEqual(firstSession.accessToken);

      // First session access validation should now fail because first session is revoked
      await expect(
        sessionService.validateSession(firstSession.accessToken),
      ).rejects.toThrow(SessionRevokedException);

      // Second session must still be valid
      const validated = await sessionService.validateSession(
        secondSession.accessToken,
      );
      expect(validated.user.id).toBe(user.id);
    });

    it('should monotonically increment sessionVersion on subsequent logins and not reset on logout', async () => {
      const user = await userRepo.create({
        id: 'user-version-test',
        email: 'user-ver@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      // Login 1 -> version 1
      const login1 = await sessionService.createSession(user.id);
      const claims1 = await tokenService.verifyToken(login1.accessToken);
      expect(claims1.sessionVersion).toBe(1);

      // Login 2 -> version 2
      const login2 = await sessionService.createSession(user.id);
      const claims2 = await tokenService.verifyToken(login2.accessToken);
      expect(claims2.sessionVersion).toBe(2);

      // Logout session 2 -> no active session
      await sessionService.logout({ accessToken: login2.accessToken });

      // Login 3 -> version 3 (must NOT reset to 1)
      const login3 = await sessionService.createSession(user.id);
      const claims3 = await tokenService.verifyToken(login3.accessToken);
      expect(claims3.sessionVersion).toBe(3);
    });

    it('should reject access token with mismatched sessionVersion', async () => {
      const user = await userRepo.create({
        id: 'user-mismatch-test',
        email: 'user-mismatch@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const session = await sessionService.createSession(user.id);
      const claims = await tokenService.verifyToken(session.accessToken);

      // Sign a token with a tampered/stale sessionVersion
      const forgedToken = await tokenService.signToken({
        sub: user.id,
        sessionId: claims.sessionId,
        sessionVersion: claims.sessionVersion + 99,
      });

      await expect(sessionService.validateSession(forgedToken)).rejects.toThrow(
        UnauthorizedSessionException,
      );
    });
  });

  describe('Access-claim validation and absolute expiry', () => {
    it('should validate sub, sessionId, sessionVersion and fail if expired', async () => {
      const user = await userRepo.create({
        id: 'user-2',
        email: 'user2@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const { accessToken } = await sessionService.createSession(user.id);
      const validated = await sessionService.validateSession(accessToken);
      expect(validated.user.id).toBe(user.id);
      expect(validated.session.userId).toBe(user.id);

      // Manipulate expiry to past
      const sessionProps = sessionRepo.sessions.get(validated.session.id)!;
      sessionRepo.sessions.set(sessionProps.id, {
        ...sessionProps,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(sessionService.validateSession(accessToken)).rejects.toThrow(
        SessionExpiredException,
      );
    });

    it('should reject locked user', async () => {
      const user = await userRepo.create({
        id: 'user-locked',
        email: 'locked@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const { accessToken } = await sessionService.createSession(user.id);

      // User account is locked later
      userRepo.users.set(
        user.id,
        new User({
          id: user.id,
          email: user.email,
          passwordHash: user.passwordHash,
          role: user.role,
          status: 'LOCKED',
        }),
      );

      await expect(sessionService.validateSession(accessToken)).rejects.toThrow(
        UserLockedException,
      );
    });

    it('should prioritize UserLockedException over SessionRevokedException when user is locked and session is revoked', async () => {
      const user = await userRepo.create({
        id: 'user-locked-revoked',
        email: 'locked-revoked@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const { accessToken, refreshToken, csrfToken } =
        await sessionService.createSession(user.id);

      // Lock user AND revoke session (as happens during an admin lock)
      userRepo.users.set(
        user.id,
        new User({
          id: user.id,
          email: user.email,
          passwordHash: user.passwordHash,
          role: user.role,
          status: 'LOCKED',
        }),
      );
      await sessionRepo.revokeAllByUserId(user.id);

      // validateSession must throw UserLockedException (403), NOT SessionRevokedException (401)
      await expect(sessionService.validateSession(accessToken)).rejects.toThrow(
        UserLockedException,
      );

      // refreshSession must throw UserLockedException (403), NOT SessionRevokedException (401)
      await expect(
        sessionService.refreshSession(refreshToken, csrfToken),
      ).rejects.toThrow(UserLockedException);

      // rotateCsrf with accessToken must throw UserLockedException
      await expect(sessionService.rotateCsrf({ accessToken })).rejects.toThrow(
        UserLockedException,
      );

      // rotateCsrf with refreshToken must throw UserLockedException
      await expect(sessionService.rotateCsrf({ refreshToken })).rejects.toThrow(
        UserLockedException,
      );
    });
  });

  describe('Refresh rotation and reuse-family revocation', () => {
    it('should rotate refresh token and CSRF token when valid', async () => {
      const user = await userRepo.create({
        id: 'user-3',
        email: 'user3@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const original = await sessionService.createSession(user.id);
      const rotated = await sessionService.refreshSession(
        original.refreshToken,
        original.csrfToken,
      );

      expect(rotated.accessToken).toBeDefined();
      expect(rotated.refreshToken).not.toEqual(original.refreshToken);
      expect(rotated.csrfToken).not.toEqual(original.csrfToken);

      // Old refresh token is now consumed
      await expect(
        sessionService.refreshSession(original.refreshToken, rotated.csrfToken),
      ).rejects.toThrow(InvalidRefreshTokenException);

      // Replay must revoke the entire session!
      await expect(
        sessionService.validateSession(rotated.accessToken),
      ).rejects.toThrow(SessionRevokedException);
    });

    it('should reject refresh if CSRF token is stale or invalid', async () => {
      const user = await userRepo.create({
        id: 'user-4',
        email: 'user4@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const original = await sessionService.createSession(user.id);
      await expect(
        sessionService.refreshSession(
          original.refreshToken,
          'wrong-csrf-token',
        ),
      ).rejects.toThrow(InvalidCsrfTokenException);
    });
  });

  describe('CSRF bootstrap rotation', () => {
    it('should rotate CSRF digest and invalidate previous CSRF tokens', async () => {
      const user = await userRepo.create({
        id: 'user-5',
        email: 'user5@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const {
        accessToken,
        refreshToken,
        csrfToken: initialCsrf,
      } = await sessionService.createSession(user.id);

      // Bootstrap with access token
      const res1 = await sessionService.rotateCsrf({ accessToken });
      expect(res1.csrfToken).toBeDefined();
      expect(res1.csrfToken).not.toEqual(initialCsrf);

      // Bootstrap with refresh token
      const res2 = await sessionService.rotateCsrf({ refreshToken });
      expect(res2.csrfToken).toBeDefined();
      expect(res2.csrfToken).not.toEqual(res1.csrfToken);

      // Initial CSRF should now fail refresh
      await expect(
        sessionService.refreshSession(refreshToken, initialCsrf),
      ).rejects.toThrow(InvalidCsrfTokenException);

      // Latest CSRF should succeed refresh
      const refreshed = await sessionService.refreshSession(
        refreshToken,
        res2.csrfToken,
      );
      expect(refreshed.accessToken).toBeDefined();
    });
  });

  describe('Logout revocation', () => {
    it('should revoke session and prevent further access or refresh', async () => {
      const user = await userRepo.create({
        id: 'user-6',
        email: 'user6@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const { accessToken, refreshToken, csrfToken } =
        await sessionService.createSession(user.id);

      await sessionService.logout({ accessToken, csrfToken });

      await expect(sessionService.validateSession(accessToken)).rejects.toThrow(
        SessionRevokedException,
      );

      await expect(
        sessionService.refreshSession(refreshToken, csrfToken),
      ).rejects.toThrow(SessionRevokedException);
    });

    it('should handle already revoked session gracefully during logout without polluting audit logs', async () => {
      const user = await userRepo.create({
        id: 'user-7',
        email: 'user7@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const { accessToken, csrfToken } = await sessionService.createSession(
        user.id,
      );

      // First logout -> succeeds and appends LOGOUT audit record
      await sessionService.logout({ accessToken, csrfToken });
      const auditCountAfterFirstLogout = auditPort.records.length;

      // Second logout with already-revoked session -> must NOT throw error
      await expect(
        sessionService.logout({ accessToken, csrfToken }),
      ).resolves.not.toThrow();

      // Audit log count must NOT increase
      expect(auditPort.records.length).toBe(auditCountAfterFirstLogout);
    });
  });
});
