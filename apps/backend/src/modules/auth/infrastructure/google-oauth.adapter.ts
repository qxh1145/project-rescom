import { Injectable, Logger, Optional } from '@nestjs/common';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import {
  OAuthProviderPort,
  GenerateAuthUrlParams,
  ExchangeAndVerifyParams,
  GoogleUserIdentity,
} from '../application/ports/oauth-provider.port';
import { EnvService } from '../../../common/config/env.service';
import {
  GoogleProviderUnavailableException,
  InvalidGoogleIdentityException,
} from '../application/exceptions/auth.exceptions';

@Injectable()
export class GoogleOAuthAdapter implements OAuthProviderPort {
  private readonly logger = new Logger(GoogleOAuthAdapter.name);
  private readonly client: OAuth2Client;

  constructor(
    private readonly envService: EnvService,
    @Optional() clientOverride?: OAuth2Client,
  ) {
    this.client =
      clientOverride ??
      new OAuth2Client({
        clientId: this.envService.googleClientId,
        clientSecret: this.envService.googleClientSecret,
        redirectUri: this.envService.googleRedirectUri,
      });
  }

  generateAuthorizationUrl(params: GenerateAuthUrlParams): string {
    return this.client.generateAuthUrl({
      access_type: 'online', // Never request offline access or refresh token (AC1 & AC3)
      scope: ['openid', 'email'], // Only openid and email (AC1)
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      response_type: 'code',
      redirect_uri: this.envService.googleRedirectUri,
      include_granted_scopes: false,
    });
  }

  async exchangeAndVerify(
    params: ExchangeAndVerifyParams,
  ): Promise<GoogleUserIdentity> {
    let idToken: string | undefined;

    try {
      const response = await this.client.getToken({
        code: params.code,
        codeVerifier: params.codeVerifier,
        redirect_uri: this.envService.googleRedirectUri,
      });

      idToken = response.tokens.id_token ?? undefined;
    } catch {
      this.logger.error(
        'Google token exchange failed: safe error logged without tokens or secrets',
      );
      throw new GoogleProviderUnavailableException();
    }

    if (!idToken) {
      throw new InvalidGoogleIdentityException(
        'ID token is missing from Google token response',
      );
    }

    let payload: any;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.envService.googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      this.logger.error('Google ID token verification failed');
      throw new InvalidGoogleIdentityException(
        'ID token signature or claims verification failed',
      );
    }

    if (!payload) {
      throw new InvalidGoogleIdentityException('ID token payload is empty');
    }

    // Issuer check
    const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
    if (!payload.iss || !validIssuers.includes(payload.iss)) {
      throw new InvalidGoogleIdentityException('Invalid ID token issuer');
    }

    // Nonce check
    const isNonceValid = params.verifyNonce
      ? params.verifyNonce(payload.nonce)
      : payload.nonce === params.expectedNonce;

    if (!payload.nonce || !isNonceValid) {
      throw new InvalidGoogleIdentityException(
        'ID token nonce does not match intent nonce',
      );
    }

    // Expiry check
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < nowSec) {
      throw new InvalidGoogleIdentityException('ID token has expired');
    }

    // Subject validation: non-empty ASCII no longer than 255 chars
    const sub = payload.sub;
    if (
      typeof sub !== 'string' ||
      sub.length === 0 ||
      sub.length > 255 ||
      !/^[\x20-\x7E]+$/.test(sub)
    ) {
      throw new InvalidGoogleIdentityException(
        'Subject (sub) claim is invalid, non-ASCII, or exceeds 255 characters',
      );
    }

    // Email and email_verified check
    const email = payload.email;
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new InvalidGoogleIdentityException(
        'Email claim is missing or empty',
      );
    }

    if (payload.email_verified !== true) {
      throw new InvalidGoogleIdentityException(
        'Email is not verified by Google',
      );
    }

    return {
      sub,
      email: email.trim().toLowerCase(),
      emailVerified: true,
    };
  }
}
