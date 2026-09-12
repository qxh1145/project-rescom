import { GoogleOAuthService } from './google-oauth.service';
import { InMemoryOAuthIntentRepository } from '../infrastructure/in-memory-oauth-intent.repository';
import { InMemoryOAuthRepository } from '../infrastructure/in-memory-oauth.repository';
import { InMemoryUserRepository } from '../../users/infrastructure/in-memory-user.repository';
import { InMemorySessionRepository } from '../infrastructure/in-memory-session.repository';
import { InMemoryIdentityAuditRepository } from '../infrastructure/in-memory-identity-audit.repository';
import { SessionService } from './session.service';
import { PasswordHasherPort } from './ports/password-hasher.port';
import {
  TokenServicePort,
  AccessTokenClaims,
} from './ports/token-service.port';
import { SecretProtectionPort } from './ports/secret-protection.port';
import {
  OAuthProviderPort,
  GenerateAuthUrlParams,
  ExchangeAndVerifyParams,
  GoogleUserIdentity,
} from './ports/oauth-provider.port';
import {
  InvalidCredentialsException,
  GoogleProviderUnavailableException,
} from './exceptions/auth.exceptions';

describe('GoogleOAuthService (Tasks 5 & 6)', () => {
  let service: GoogleOAuthService;
  let oauthProvider: MockOAuthProvider;
  let intentRepo: InMemoryOAuthIntentRepository;
  let oauthRepo: InMemoryOAuthRepository;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let passwordHasher: MockPasswordHasher;
  let tokenService: MockTokenService;
  let secretProtection: MockSecretProtection;
  let sessionService: SessionService;

  class MockOAuthProvider implements OAuthProviderPort {
    generateAuthorizationUrl(params: GenerateAuthUrlParams): string {
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${params.state}&nonce=${params.nonce}`;
    }

    async exchangeAndVerify(
      params: ExchangeAndVerifyParams,
    ): Promise<GoogleUserIdentity> {
      if (params.code === 'unavailable-code') {
        throw new GoogleProviderUnavailableException();
      }
      return {
        sub: 'google-sub-user1',
        email: 'user1@gmail.com',
        emailVerified: true,
      };
    }
  }

  class MockPasswordHasher implements PasswordHasherPort {
    async hash(password: string): Promise<string> {
      return `$hash:${password}`;
    }
    async compare(password: string, hash: string): Promise<boolean> {
      return hash === `$hash:${password}`;
    }
    async compareDummy(): Promise<boolean> {
      return false;
    }
  }

  class MockTokenService implements TokenServicePort {
    async signToken(payload: AccessTokenClaims): Promise<string> {
      return `jwt.${payload.sessionId}.${payload.sub}`;
    }
    async verifyToken(token: string): Promise<AccessTokenClaims> {
      const parts = token.split('.');
      return {
        sessionId: parts[1],
        sub: parts[2],
        sessionVersion: 1,
      };
    }
  }

  class MockSecretProtection implements SecretProtectionPort {
    hashRefreshSecret(secret: string): string {
      return `ref-digest:${secret}`;
    }
    verifyRefreshSecret(secret: string, digest: string): boolean {
      return digest === `ref-digest:${secret}`;
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

  const config = {
    oauthIntentTtlSeconds: 600,
    frontendSuccessUrl: 'http://localhost:3000/auth/callback',
    frontendErrorUrl: 'http://localhost:3000/auth/error',
  };

  beforeEach(() => {
    oauthProvider = new MockOAuthProvider();
    intentRepo = new InMemoryOAuthIntentRepository();
    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    oauthRepo = new InMemoryOAuthRepository(userRepo, auditRepo);
    sessionRepo = new InMemorySessionRepository();
    passwordHasher = new MockPasswordHasher();
    tokenService = new MockTokenService();
    secretProtection = new MockSecretProtection();

    sessionService = new SessionService(
      sessionRepo,
      userRepo,
      tokenService,
      secretProtection,
      auditRepo,
      {
        jwtAccessTtlSeconds: 900,
        sessionAbsoluteTtlSeconds: 2592000,
      },
    );

    service = new GoogleOAuthService(
      oauthProvider,
      intentRepo,
      oauthRepo,
      userRepo,
      passwordHasher,
      secretProtection,
      auditRepo,
      sessionService,
      config,
    );
  });

  describe('Login Initiation & Intent Creation (AC1)', () => {
    it('should generate authorization URL and set replay-safe intent cookie', async () => {
      const { authorizationUrl, intentCookie } = await service.initiateLogin();

      expect(authorizationUrl).toContain('https://accounts.google.com');
      expect(intentCookie).toBeDefined();

      const [intentId] = intentCookie.split('.');
      const intent = await intentRepo.findById(intentId);

      expect(intent).not.toBeNull();
      expect(intent?.flowType).toBe('LOGIN');
      expect(intent?.isConsumed()).toBe(false);
    });
  });

  describe('Callback & Replay-Safe Validation (AC2, AC3, AC4, AC5, AC6)', () => {
    it('should complete first-time login, create user & session, and clear intent cookie', async () => {
      const { intentCookie } = await service.initiateLogin();
      const [intentId] = intentCookie.split('.');
      const intent = await intentRepo.findById(intentId);

      // Reconstruct state matching digest
      // In our mock: hashOAuthSecret(state) = `oauth-digest:${state}`
      // Stored digest was `oauth-digest:${state}` so state can be extracted:
      const rawState = intent!.stateDigest.replace(/^oauth-digest:/, '');

      const result = await service.handleCallback(
        { state: rawState, code: 'valid-code' },
        intentCookie,
      );

      expect(result.clearIntentCookie).toBe(true);
      expect(result.redirectUrl).toBe(config.frontendSuccessUrl);
      expect(result.sessionTokens).toBeDefined();

      // Check user was created
      const user = await userRepo.findByEmail('user1@gmail.com');
      expect(user).not.toBeNull();
      expect(user?.role).toBe('RESPONDENT');
      expect(user?.status).toBe('ACTIVE');

      // Intent must now be consumed
      const updatedIntent = await intentRepo.findById(intentId);
      expect(updatedIntent?.isConsumed()).toBe(true);

      // Verify audit log has LOGIN_SUCCESS
      const hasLoginSuccess = auditRepo.records.some(
        (r) => r.action === 'LOGIN_SUCCESS' && r.userId === user?.id,
      );
      expect(hasLoginSuccess).toBe(true);
    });

    it('should fail closed on replayed callback attempt', async () => {
      const { intentCookie } = await service.initiateLogin();
      const [intentId] = intentCookie.split('.');
      const intent = await intentRepo.findById(intentId);
      const rawState = intent!.stateDigest.replace(/^oauth-digest:/, '');

      // First callback succeeds
      await service.handleCallback(
        { state: rawState, code: 'valid-code' },
        intentCookie,
      );

      // Second callback replay fails closed
      const replayed = await service.handleCallback(
        { state: rawState, code: 'valid-code' },
        intentCookie,
      );

      expect(replayed.redirectUrl).toContain('error=AUTH_INVALID_OAUTH_INTENT');
      expect(replayed.sessionTokens).toBeUndefined();

      const hasReplayAudit = auditRepo.records.some(
        (r) => r.action === 'OAUTH_INTENT_REPLAYED',
      );
      expect(hasReplayAudit).toBe(true);
    });

    it('should map provider denial to GOOGLE_AUTH_CANCELLED', async () => {
      const { intentCookie } = await service.initiateLogin();
      const [intentId] = intentCookie.split('.');
      const intent = await intentRepo.findById(intentId);
      const rawState = intent!.stateDigest.replace(/^oauth-digest:/, '');

      const result = await service.handleCallback(
        { state: rawState, error: 'access_denied' },
        intentCookie,
      );

      expect(result.redirectUrl).toContain('error=GOOGLE_AUTH_CANCELLED');
      expect(result.sessionTokens).toBeUndefined();
    });

    it('should map email collision to AUTH_GOOGLE_LINK_REQUIRED without auto-linking (AC6)', async () => {
      // User already exists with password
      await userRepo.create({
        id: 'existing-u',
        email: 'user1@gmail.com',
        passwordHash: '$hash:Password123!',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const { intentCookie } = await service.initiateLogin();
      const [intentId] = intentCookie.split('.');
      const intent = await intentRepo.findById(intentId);
      const rawState = intent!.stateDigest.replace(/^oauth-digest:/, '');

      const result = await service.handleCallback(
        { state: rawState, code: 'valid-code' },
        intentCookie,
      );

      expect(result.redirectUrl).toContain('error=AUTH_GOOGLE_LINK_REQUIRED');
      expect(result.sessionTokens).toBeUndefined();
    });
  });

  describe('Explicit Google Link and Unlink (AC7)', () => {
    it('should link Google account after password verification', async () => {
      const user = await userRepo.create({
        id: 'link-user-1',
        email: 'linkuser@example.com',
        passwordHash: '$hash:CorrectPassword123!',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      // Wrong password fails
      await expect(
        service.initiateLink(user.id, 'WrongPassword!'),
      ).rejects.toThrow(InvalidCredentialsException);

      // Correct password generates link intent
      const { authorizationUrl, intentCookie } = await service.initiateLink(
        user.id,
        'CorrectPassword123!',
      );
      expect(authorizationUrl).toContain('https://accounts.google.com');

      const [intentId] = intentCookie.split('.');
      const intent = await intentRepo.findById(intentId);
      const rawState = intent!.stateDigest.replace(/^oauth-digest:/, '');

      // Callback completes link
      const result = await service.handleCallback(
        { state: rawState, code: 'valid-code' },
        intentCookie,
      );

      expect(result.redirectUrl).toBe(config.frontendSuccessUrl);

      const hasLinkedAudit = auditRepo.records.some(
        (r) => r.action === 'IDENTITY_LINKED' && r.userId === user.id,
      );
      expect(hasLinkedAudit).toBe(true);
    });

    it('should unlink when user has password and reject unlink when final method', async () => {
      const user = await userRepo.create({
        id: 'unlink-user-1',
        email: 'unlink@example.com',
        passwordHash: '$hash:MyPassword!',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      await oauthRepo.linkGoogleIdentity({
        userId: user.id,
        sub: 'google-sub-to-unlink',
      });

      // Wrong password fails
      await expect(service.unlink(user.id, 'WrongPassword')).rejects.toThrow(
        InvalidCredentialsException,
      );

      // Correct password unlinks
      await service.unlink(user.id, 'MyPassword!');

      const hasUnlinkedAudit = auditRepo.records.some(
        (r) => r.action === 'IDENTITY_UNLINKED' && r.userId === user.id,
      );
      expect(hasUnlinkedAudit).toBe(true);
    });
  });
});
