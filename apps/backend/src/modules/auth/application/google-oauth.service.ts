import { randomUUID, randomBytes, createHash } from 'crypto';
import { OAuthProviderPort } from './ports/oauth-provider.port';
import { OAuthIntentRepositoryPort } from './ports/oauth-intent-repository.port';
import { OAuthPersistencePort } from './ports/oauth-persistence.port';
import { UserRepositoryPort } from '../../users/application/ports/user.repository.port';
import { PasswordHasherPort } from './ports/password-hasher.port';
import { SecretProtectionPort } from './ports/secret-protection.port';
import { IdentityAuditPort } from './ports/identity-audit.port';
import { SessionService, SessionTokens } from './session.service';
import { GoogleCallbackQuery } from '@rescom/schemas';
import {
  InvalidCredentialsException,
  GoogleLinkRequiredException,
  GoogleIdentityConflictException,
  UserLockedException,
} from './exceptions/auth.exceptions';

export interface GoogleOAuthConfig {
  oauthIntentTtlSeconds: number;
  frontendSuccessUrl: string;
  frontendErrorUrl: string;
}

export interface GoogleAuthCallbackResult {
  redirectUrl: string;
  sessionTokens?: SessionTokens;
  clearIntentCookie: boolean;
}

export class GoogleOAuthService {
  constructor(
    private readonly oauthProvider: OAuthProviderPort,
    private readonly oauthIntentRepository: OAuthIntentRepositoryPort,
    private readonly oauthPersistence: OAuthPersistencePort,
    private readonly userRepository: UserRepositoryPort,
    private readonly passwordHasher: PasswordHasherPort,
    private readonly secretProtection: SecretProtectionPort,
    private readonly identityAudit: IdentityAuditPort,
    private readonly sessionService: SessionService,
    private readonly config: GoogleOAuthConfig,
    private readonly generateId: () => string = randomUUID,
    private readonly generateSecret: () => string = () =>
      randomBytes(32).toString('hex'),
  ) {}

  async initiateLogin(
    existingIntentCookie?: string,
  ): Promise<{ authorizationUrl: string; intentCookie: string }> {
    if (existingIntentCookie) {
      const parts = existingIntentCookie.split('.');
      if (parts.length === 2 && parts[1]) {
        const oldHash = this.secretProtection.hashOAuthSecret(parts[1]);
        await this.oauthIntentRepository.invalidatePriorIntents({
          browserBindingDigest: oldHash,
        });
      }
    }

    const intentId = this.generateId();
    const state = this.generateSecret();
    const nonce = this.generateSecret();
    const browserBindingSecret = this.generateSecret();

    // Generate PKCE
    const verifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(verifier)
      .digest('base64url');
    const pkceVerifierEncrypted =
      this.secretProtection.encryptPkceVerifier(verifier);

    const stateDigest = this.secretProtection.hashOAuthSecret(state);
    const nonceDigest = this.secretProtection.hashOAuthSecret(nonce);
    const browserBindingDigest =
      this.secretProtection.hashOAuthSecret(browserBindingSecret);

    // Invalidate any active intents matching this browser binding
    await this.oauthIntentRepository.invalidatePriorIntents({
      browserBindingDigest,
    });

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.oauthIntentTtlSeconds * 1000,
    );

    await this.oauthIntentRepository.createIntent({
      id: intentId,
      flowType: 'LOGIN',
      targetUserId: null,
      stateDigest,
      nonceDigest,
      browserBindingDigest,
      pkceVerifierEncrypted,
      expiresAt,
      consumedAt: null,
      failedAt: null,
      createdAt: now,
    });

    const authorizationUrl = this.oauthProvider.generateAuthorizationUrl({
      state,
      nonce,
      codeChallenge,
    });

    const intentCookie = `${intentId}.${browserBindingSecret}`;

    return {
      authorizationUrl,
      intentCookie,
    };
  }

  async initiateLink(
    userId: string,
    currentPassword: string,
  ): Promise<{ authorizationUrl: string; intentCookie: string }> {
    // 1. Password verification as recent-authentication proof (AC7)
    const user = await this.userRepository.findById(userId);
    if (!user || !user.hasPassword() || !user.passwordHash) {
      throw new InvalidCredentialsException();
    }

    const isPasswordValid = await this.passwordHasher.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new InvalidCredentialsException();
    }

    // 2. Check if user already has a Google identity
    const { identityCount } =
      await this.oauthPersistence.countUserLoginMethods(userId);
    if (identityCount > 0) {
      throw new GoogleIdentityConflictException(
        'User already has a linked Google identity',
      );
    }

    // Invalidate prior link intents for targetUser
    await this.oauthIntentRepository.invalidatePriorIntents({
      targetUserId: userId,
    });

    const intentId = this.generateId();
    const state = this.generateSecret();
    const nonce = this.generateSecret();
    const browserBindingSecret = this.generateSecret();

    const verifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(verifier)
      .digest('base64url');
    const pkceVerifierEncrypted =
      this.secretProtection.encryptPkceVerifier(verifier);

    const stateDigest = this.secretProtection.hashOAuthSecret(state);
    const nonceDigest = this.secretProtection.hashOAuthSecret(nonce);
    const browserBindingDigest =
      this.secretProtection.hashOAuthSecret(browserBindingSecret);

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.oauthIntentTtlSeconds * 1000,
    );

    await this.oauthIntentRepository.createIntent({
      id: intentId,
      flowType: 'LINK',
      targetUserId: userId,
      stateDigest,
      nonceDigest,
      browserBindingDigest,
      pkceVerifierEncrypted,
      expiresAt,
      consumedAt: null,
      failedAt: null,
      createdAt: now,
    });

    const authorizationUrl = this.oauthProvider.generateAuthorizationUrl({
      state,
      nonce,
      codeChallenge,
    });

    const intentCookie = `${intentId}.${browserBindingSecret}`;

    return {
      authorizationUrl,
      intentCookie,
    };
  }

  async handleCallback(
    query: GoogleCallbackQuery,
    rawIntentCookie?: string,
  ): Promise<GoogleAuthCallbackResult> {
    const errorUrl = (code: string) =>
      `${this.config.frontendErrorUrl}?error=${encodeURIComponent(code)}`;

    // Step A: Cookie format
    if (!rawIntentCookie) {
      await this.identityAudit.append({
        action: 'OAUTH_INTENT_REJECTED',
        outcome: 'FAILURE',
        errorCode: 'AUTH_INVALID_OAUTH_INTENT',
        metadata: { reason: 'MISSING_COOKIE' },
      });
      return {
        redirectUrl: errorUrl('AUTH_INVALID_OAUTH_INTENT'),
        clearIntentCookie: true,
      };
    }

    const parts = rawIntentCookie.split('.');
    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (parts.length !== 2 || !UUID_REGEX.test(parts[0]) || !parts[1]) {
      await this.identityAudit.append({
        action: 'OAUTH_INTENT_REJECTED',
        outcome: 'FAILURE',
        errorCode: 'AUTH_INVALID_OAUTH_INTENT',
        metadata: { reason: 'MALFORMED_COOKIE' },
      });
      return {
        redirectUrl: errorUrl('AUTH_INVALID_OAUTH_INTENT'),
        clearIntentCookie: true,
      };
    }

    const [intentId, browserBindingSecret] = parts;

    // Step B: Atomically consume intent (AC2)
    const consumedIntent =
      await this.oauthIntentRepository.consumeIntent(intentId);

    if (!consumedIntent) {
      // Replay or non-existent or expired
      const existing = await this.oauthIntentRepository.findById(intentId);
      const isReplay = existing && existing.isConsumed();

      await this.identityAudit.append({
        action: isReplay ? 'OAUTH_INTENT_REPLAYED' : 'OAUTH_INTENT_REJECTED',
        outcome: 'FAILURE',
        errorCode: 'AUTH_INVALID_OAUTH_INTENT',
        metadata: { intentId, isReplay },
      });
      return {
        redirectUrl: errorUrl('AUTH_INVALID_OAUTH_INTENT'),
        clearIntentCookie: true,
      };
    }

    // Step C: Verify browser binding & state digests (AC2)
    const isBindingValid = this.secretProtection.verifyOAuthSecret(
      browserBindingSecret,
      consumedIntent.browserBindingDigest,
    );
    if (!isBindingValid) {
      await this.identityAudit.append({
        action: 'OAUTH_INTENT_REJECTED',
        outcome: 'FAILURE',
        errorCode: 'AUTH_INVALID_OAUTH_INTENT',
        metadata: { reason: 'BROWSER_BINDING_MISMATCH' },
      });
      return {
        redirectUrl: errorUrl('AUTH_INVALID_OAUTH_INTENT'),
        clearIntentCookie: true,
      };
    }

    const isStateValid = this.secretProtection.verifyOAuthSecret(
      query.state,
      consumedIntent.stateDigest,
    );
    if (!isStateValid) {
      await this.identityAudit.append({
        action: 'OAUTH_INTENT_REJECTED',
        outcome: 'FAILURE',
        errorCode: 'AUTH_INVALID_OAUTH_INTENT',
        metadata: { reason: 'STATE_MISMATCH' },
      });
      return {
        redirectUrl: errorUrl('AUTH_INVALID_OAUTH_INTENT'),
        clearIntentCookie: true,
      };
    }

    // Step D: Check provider error (AC2: Provider denial maps to GOOGLE_AUTH_CANCELLED)
    if (query.error) {
      await this.identityAudit.append({
        action: 'LOGIN_FAILURE',
        outcome: 'FAILURE',
        errorCode: 'GOOGLE_AUTH_CANCELLED',
        metadata: { flowType: consumedIntent.flowType },
      });
      return {
        redirectUrl: errorUrl('GOOGLE_AUTH_CANCELLED'),
        clearIntentCookie: true,
      };
    }

    if (!query.code) {
      await this.identityAudit.append({
        action: 'OAUTH_INTENT_REJECTED',
        outcome: 'FAILURE',
        errorCode: 'AUTH_INVALID_OAUTH_INTENT',
        metadata: { reason: 'MISSING_CODE' },
      });
      return {
        redirectUrl: errorUrl('AUTH_INVALID_OAUTH_INTENT'),
        clearIntentCookie: true,
      };
    }

    // Step E: Code exchange and ID token verification (AC3)
    let googleIdentity;
    try {
      const codeVerifier = this.secretProtection.decryptPkceVerifier(
        consumedIntent.pkceVerifierEncrypted,
      );

      googleIdentity = await this.oauthProvider.exchangeAndVerify({
        code: query.code,
        codeVerifier,
        verifyNonce: (tokenNonce: string) =>
          this.secretProtection.verifyOAuthSecret(
            tokenNonce,
            consumedIntent.nonceDigest,
          ),
      });
    } catch (err: any) {
      const isUnavailable = err.code === 'AUTH_GOOGLE_PROVIDER_UNAVAILABLE';
      const errorCode = isUnavailable
        ? 'AUTH_GOOGLE_PROVIDER_UNAVAILABLE'
        : 'AUTH_INVALID_GOOGLE_IDENTITY';

      await this.identityAudit.append({
        action: 'LOGIN_FAILURE',
        outcome: 'FAILURE',
        errorCode,
        metadata: { flowType: consumedIntent.flowType },
      });
      return { redirectUrl: errorUrl(errorCode), clearIntentCookie: true };
    }

    // Step F: Account resolution and session issuance (AC4, AC5, AC6, AC7, AC8)
    if (consumedIntent.flowType === 'LOGIN') {
      try {
        const { user } = await this.oauthPersistence.resolveGoogleUser({
          sub: googleIdentity.sub,
          email: googleIdentity.email,
        });

        // Local session issuance only AFTER durable user resolution (AC8)
        const sessionTokens = await this.sessionService.createSession(user.id);

        await this.identityAudit.append({
          action: 'LOGIN_SUCCESS',
          userId: user.id,
          outcome: 'SUCCESS',
          metadata: { provider: 'GOOGLE' },
        });

        return {
          redirectUrl: this.config.frontendSuccessUrl,
          sessionTokens,
          clearIntentCookie: true,
        };
      } catch (err: any) {
        if (err instanceof GoogleLinkRequiredException) {
          await this.identityAudit.append({
            action: 'LOGIN_FAILURE',
            outcome: 'FAILURE',
            errorCode: 'AUTH_GOOGLE_LINK_REQUIRED',
          });
          return {
            redirectUrl: errorUrl('AUTH_GOOGLE_LINK_REQUIRED'),
            clearIntentCookie: true,
          };
        }

        if (err instanceof UserLockedException) {
          await this.identityAudit.append({
            action: 'LOGIN_FAILURE',
            outcome: 'FAILURE',
            errorCode: 'AUTH_INVALID_CREDENTIALS',
          });
          return {
            redirectUrl: errorUrl('AUTH_INVALID_CREDENTIALS'),
            clearIntentCookie: true,
          };
        }

        await this.identityAudit.append({
          action: 'LOGIN_FAILURE',
          outcome: 'FAILURE',
          errorCode: 'AUTH_INVALID_GOOGLE_IDENTITY',
        });
        return {
          redirectUrl: errorUrl('AUTH_INVALID_GOOGLE_IDENTITY'),
          clearIntentCookie: true,
        };
      }
    } else if (consumedIntent.flowType === 'LINK') {
      if (!consumedIntent.targetUserId) {
        await this.identityAudit.append({
          action: 'OAUTH_INTENT_REJECTED',
          outcome: 'FAILURE',
          errorCode: 'AUTH_INVALID_OAUTH_INTENT',
        });
        return {
          redirectUrl: errorUrl('AUTH_INVALID_OAUTH_INTENT'),
          clearIntentCookie: true,
        };
      }

      const targetUser = await this.userRepository.findById(
        consumedIntent.targetUserId,
      );
      if (!targetUser) {
        await this.identityAudit.append({
          action: 'IDENTITY_LINKED',
          userId: consumedIntent.targetUserId,
          outcome: 'FAILURE',
          errorCode: 'AUTH_INVALID_CREDENTIALS',
        });
        return {
          redirectUrl: errorUrl('AUTH_INVALID_CREDENTIALS'),
          clearIntentCookie: true,
        };
      }
      if (targetUser.isLocked()) {
        await this.identityAudit.append({
          action: 'IDENTITY_LINKED',
          userId: consumedIntent.targetUserId,
          outcome: 'FAILURE',
          errorCode: 'AUTH_USER_LOCKED',
        });
        return {
          redirectUrl: errorUrl('AUTH_USER_LOCKED'),
          clearIntentCookie: true,
        };
      }

      const existingByEmail = await this.userRepository.findByEmail(
        googleIdentity.email,
      );
      if (existingByEmail && existingByEmail.id !== targetUser.id) {
        await this.identityAudit.append({
          action: 'IDENTITY_LINKED',
          userId: consumedIntent.targetUserId,
          outcome: 'FAILURE',
          errorCode: 'AUTH_GOOGLE_IDENTITY_CONFLICT',
        });
        return {
          redirectUrl: errorUrl('AUTH_GOOGLE_IDENTITY_CONFLICT'),
          clearIntentCookie: true,
        };
      }

      try {
        await this.oauthPersistence.linkGoogleIdentity({
          userId: consumedIntent.targetUserId,
          sub: googleIdentity.sub,
          auditRecord: {
            action: 'IDENTITY_LINKED',
            userId: consumedIntent.targetUserId,
            outcome: 'SUCCESS',
            metadata: { provider: 'GOOGLE' },
          },
        });

        return {
          redirectUrl: this.config.frontendSuccessUrl,
          clearIntentCookie: true,
        };
      } catch (err: any) {
        if (err instanceof GoogleIdentityConflictException) {
          await this.identityAudit.append({
            action: 'IDENTITY_LINKED',
            userId: consumedIntent.targetUserId,
            outcome: 'FAILURE',
            errorCode: 'AUTH_GOOGLE_IDENTITY_CONFLICT',
          });
          return {
            redirectUrl: errorUrl('AUTH_GOOGLE_IDENTITY_CONFLICT'),
            clearIntentCookie: true,
          };
        }

        return {
          redirectUrl: errorUrl('AUTH_INVALID_GOOGLE_IDENTITY'),
          clearIntentCookie: true,
        };
      }
    }

    return {
      redirectUrl: errorUrl('AUTH_INVALID_OAUTH_INTENT'),
      clearIntentCookie: true,
    };
  }

  async unlink(userId: string, currentPassword: string): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.hasPassword() || !user.passwordHash) {
      throw new InvalidCredentialsException();
    }

    const isPasswordValid = await this.passwordHasher.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new InvalidCredentialsException();
    }

    await this.oauthPersistence.unlinkGoogleIdentity({
      userId,
      auditRecord: {
        action: 'IDENTITY_UNLINKED',
        userId,
        outcome: 'SUCCESS',
        metadata: { provider: 'GOOGLE' },
      },
    });
  }
}
