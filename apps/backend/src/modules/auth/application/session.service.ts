import { randomUUID, randomBytes } from 'crypto';
import { SessionRepositoryPort } from './ports/session-repository.port';
import { UserRepositoryPort } from '../../users/application/ports/user.repository.port';
import { TokenServicePort } from './ports/token-service.port';
import { SecretProtectionPort } from './ports/secret-protection.port';
import { IdentityAuditPort } from './ports/identity-audit.port';
import {
  Session,
  SessionProps,
  RefreshCredentialProps,
} from '../domain/session.entity';
import { User } from '../../users/domain/user.entity';
import {
  UnauthorizedSessionException,
  SessionExpiredException,
  SessionRevokedException,
  InvalidRefreshTokenException,
  InvalidCsrfTokenException,
  UserLockedException,
} from './exceptions/auth.exceptions';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

export interface SessionConfig {
  jwtAccessTtlSeconds: number;
  sessionAbsoluteTtlSeconds: number;
}

export class SessionService {
  constructor(
    private readonly sessionRepository: SessionRepositoryPort,
    private readonly userRepository: UserRepositoryPort,
    private readonly tokenService: TokenServicePort,
    private readonly secretProtection: SecretProtectionPort,
    private readonly identityAudit: IdentityAuditPort,
    private readonly config: SessionConfig,
    private readonly generateId: () => string = randomUUID,
    private readonly generateSecret: () => string = () =>
      randomBytes(32).toString('hex'),
  ) {}

  async createSession(userId: string): Promise<SessionTokens> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedSessionException('User does not exist');
    }
    if (user.isLocked()) {
      throw new UserLockedException();
    }

    const sessionId = this.generateId();
    const credentialId = this.generateId();
    const rawRefreshSecret = this.generateSecret();
    const rawCsrfToken = this.generateSecret();

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.sessionAbsoluteTtlSeconds * 1000,
    );

    const csrfDigest = this.secretProtection.hashCsrfToken(rawCsrfToken);
    const refreshSecretDigest =
      this.secretProtection.hashRefreshSecret(rawRefreshSecret);

    const sessionProps: Omit<SessionProps, 'sessionVersion'> = {
      id: sessionId,
      userId,
      csrfDigest,
      revoked: false,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    const credentialProps: RefreshCredentialProps = {
      id: credentialId,
      sessionId,
      secretDigest: refreshSecretDigest,
      isUsed: false,
      usedAt: null,
      expiresAt,
      createdAt: now,
    };

    const committedSession = await this.sessionRepository.replaceUserSession(
      userId,
      {
        session: sessionProps,
        credential: credentialProps,
        audit: {
          action: 'SESSION_REPLACED',
          userId,
          outcome: 'SUCCESS',
          metadata: { sessionId },
        },
      },
    );

    const accessToken = await this.tokenService.signToken({
      sub: userId,
      sessionId: committedSession.id,
      sessionVersion: committedSession.sessionVersion,
    });

    const refreshToken = `${credentialId}.${rawRefreshSecret}`;

    return {
      accessToken,
      refreshToken,
      csrfToken: rawCsrfToken,
    };
  }

  async validateSession(
    accessToken: string,
  ): Promise<{ session: Session; user: User }> {
    const claims = await this.tokenService.verifyToken(accessToken);

    if (!claims?.sessionId || !UUID_REGEX.test(claims.sessionId)) {
      throw new UnauthorizedSessionException('Session not found');
    }

    const session = await this.sessionRepository.findById(claims.sessionId);
    if (!session) {
      throw new UnauthorizedSessionException('Session not found');
    }

    if (session.revoked) {
      throw new SessionRevokedException();
    }

    if (session.isExpired()) {
      throw new SessionExpiredException();
    }

    if (
      session.userId !== claims.sub ||
      session.sessionVersion !== claims.sessionVersion
    ) {
      throw new UnauthorizedSessionException('Session claims mismatch');
    }

    const user = await this.userRepository.findById(session.userId);
    if (!user) {
      throw new UnauthorizedSessionException('User not found');
    }

    if (user.isLocked()) {
      throw new UserLockedException();
    }

    return { session, user };
  }

  async rotateCsrf(params: {
    accessToken?: string;
    refreshToken?: string;
  }): Promise<{ csrfToken: string }> {
    let session: Session | null = null;

    if (params.accessToken) {
      try {
        const validated = await this.validateSession(params.accessToken);
        session = validated.session;
      } catch (err) {
        if (!params.refreshToken) {
          throw err;
        }
      }
    }

    if (!session && params.refreshToken) {
      const parts = params.refreshToken.split('.');
      if (parts.length !== 2 || !UUID_REGEX.test(parts[0]) || !parts[1]) {
        throw new InvalidRefreshTokenException();
      }
      const [credentialId, rawSecret] = parts;
      const found =
        await this.sessionRepository.findCredentialWithSession(credentialId);
      if (!found) {
        throw new InvalidRefreshTokenException();
      }

      if (found.session.revoked) {
        throw new SessionRevokedException();
      }

      if (found.session.isExpired() || found.credential.isExpired()) {
        throw new SessionExpiredException();
      }

      if (found.credential.isUsed) {
        await this.sessionRepository.revokeSession(found.session.id, {
          action: 'REFRESH_REUSE_REVOKED',
          userId: found.session.userId,
          outcome: 'FAILURE',
          errorCode: 'AUTH_INVALID_REFRESH_TOKEN',
        });
        throw new InvalidRefreshTokenException();
      }

      const isValid = this.secretProtection.verifyRefreshSecret(
        rawSecret,
        found.credential.secretDigest,
      );
      if (!isValid) {
        throw new InvalidRefreshTokenException();
      }

      const user = await this.userRepository.findById(found.session.userId);
      if (!user) {
        throw new UnauthorizedSessionException('User not found');
      }
      if (user.isLocked()) {
        throw new UserLockedException();
      }

      session = found.session;
    } else if (!session) {
      throw new UnauthorizedSessionException();
    }

    const newCsrfToken = this.generateSecret();
    const newCsrfDigest = this.secretProtection.hashCsrfToken(newCsrfToken);

    await this.sessionRepository.updateCsrfDigest(session.id, newCsrfDigest);

    return { csrfToken: newCsrfToken };
  }

  async refreshSession(
    rawRefreshToken: string,
    csrfToken: string,
  ): Promise<SessionTokens> {
    const parts = rawRefreshToken.split('.');
    if (parts.length !== 2 || !UUID_REGEX.test(parts[0]) || !parts[1]) {
      throw new InvalidRefreshTokenException();
    }
    const [credentialId, rawSecret] = parts;

    const found =
      await this.sessionRepository.findCredentialWithSession(credentialId);
    if (!found) {
      throw new InvalidRefreshTokenException();
    }

    const { credential, session } = found;

    if (session.revoked) {
      throw new SessionRevokedException();
    }

    if (session.isExpired() || credential.isExpired()) {
      throw new SessionExpiredException();
    }

    if (credential.isUsed) {
      await this.sessionRepository.revokeSession(session.id, {
        action: 'REFRESH_REUSE_REVOKED',
        userId: session.userId,
        outcome: 'FAILURE',
        errorCode: 'AUTH_INVALID_REFRESH_TOKEN',
      });
      throw new InvalidRefreshTokenException();
    }

    const isSecretValid = this.secretProtection.verifyRefreshSecret(
      rawSecret,
      credential.secretDigest,
    );
    if (!isSecretValid) {
      throw new InvalidRefreshTokenException();
    }

    if (
      !csrfToken ||
      !this.secretProtection.verifyCsrfToken(csrfToken, session.csrfDigest)
    ) {
      throw new InvalidCsrfTokenException();
    }

    const user = await this.userRepository.findById(session.userId);
    if (!user || user.isLocked()) {
      throw new UserLockedException();
    }

    const newCredentialId = this.generateId();
    const newRawRefreshSecret = this.generateSecret();
    const newRawCsrfToken = this.generateSecret();

    const newSecretDigest =
      this.secretProtection.hashRefreshSecret(newRawRefreshSecret);
    const newCsrfDigest = this.secretProtection.hashCsrfToken(newRawCsrfToken);

    const newCredentialProps = {
      id: newCredentialId,
      sessionId: session.id,
      secretDigest: newSecretDigest,
      isUsed: false,
      usedAt: null,
      expiresAt: session.expiresAt,
      createdAt: new Date(),
    };

    await this.sessionRepository.rotateRefreshCredential(
      credential.id,
      newCredentialProps,
      newCsrfDigest,
      {
        action: 'REFRESH_ROTATED',
        userId: session.userId,
        outcome: 'SUCCESS',
      },
    );

    const accessToken = await this.tokenService.signToken({
      sub: session.userId,
      sessionId: session.id,
      sessionVersion: session.sessionVersion,
    });

    const newRefreshToken = `${newCredentialId}.${newRawRefreshSecret}`;

    return {
      accessToken,
      refreshToken: newRefreshToken,
      csrfToken: newRawCsrfToken,
    };
  }

  async logout(params: {
    accessToken?: string;
    refreshToken?: string;
    csrfToken?: string;
  }): Promise<void> {
    if (params.accessToken) {
      try {
        const claims = await this.tokenService.verifyToken(params.accessToken);
        const session = await this.sessionRepository.findById(claims.sessionId);
        if (session && !session.revoked) {
          if (
            params.csrfToken &&
            !this.secretProtection.verifyCsrfToken(
              params.csrfToken,
              session.csrfDigest,
            )
          ) {
            throw new InvalidCsrfTokenException();
          }
          await this.sessionRepository.revokeSession(claims.sessionId, {
            action: 'LOGOUT',
            userId: claims.sub,
            outcome: 'SUCCESS',
          });
          return;
        }
      } catch (err) {
        if (err instanceof InvalidCsrfTokenException) throw err;
        // Fall back to refresh token if access token is expired/invalid
      }
    }

    if (params.refreshToken) {
      const parts = params.refreshToken.split('.');
      if (parts.length === 2) {
        const UUID_REGEX =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!UUID_REGEX.test(parts[0])) return;

        const found = await this.sessionRepository.findCredentialWithSession(
          parts[0],
        );
        if (found && !found.session.revoked) {
          if (
            !this.secretProtection.verifyRefreshSecret(
              parts[1],
              found.credential.secretDigest,
            )
          ) {
            return;
          }
          if (
            params.csrfToken &&
            !this.secretProtection.verifyCsrfToken(
              params.csrfToken,
              found.session.csrfDigest,
            )
          ) {
            throw new InvalidCsrfTokenException();
          }
          await this.sessionRepository.revokeSession(found.session.id, {
            action: 'LOGOUT',
            userId: found.session.userId,
            outcome: 'SUCCESS',
          });
        }
      }
    }
  }
}
