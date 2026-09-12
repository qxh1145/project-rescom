export interface GoogleUserIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
}

export interface GenerateAuthUrlParams {
  state: string;
  nonce: string;
  codeChallenge: string;
}

export interface ExchangeAndVerifyParams {
  code: string;
  codeVerifier: string;
  expectedNonce?: string;
  verifyNonce?: (nonce: string) => boolean;
}

export interface OAuthProviderPort {
  generateAuthorizationUrl(params: GenerateAuthUrlParams): string;
  exchangeAndVerify(
    params: ExchangeAndVerifyParams,
  ): Promise<GoogleUserIdentity>;
}

export const OAUTH_PROVIDER_PORT = Symbol('OAuthProviderPort');
