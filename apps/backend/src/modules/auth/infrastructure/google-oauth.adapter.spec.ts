import { GoogleOAuthAdapter } from './google-oauth.adapter';
import { EnvService } from '../../../common/config/env.service';
import {
  GoogleProviderUnavailableException,
  InvalidGoogleIdentityException,
} from '../application/exceptions/auth.exceptions';

describe('GoogleOAuthAdapter (Task 2 Provider Adapter)', () => {
  let adapter: GoogleOAuthAdapter;
  let mockClient: any;
  let envService: EnvService;

  beforeEach(() => {
    envService = new EnvService({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      GOOGLE_CLIENT_ID: 'google-client-id-123',
      GOOGLE_CLIENT_SECRET: 'google-client-secret-456',
      GOOGLE_REDIRECT_URI: 'http://localhost:4000/auth/google/callback',
      AUTH_FRONTEND_SUCCESS_URL: 'http://localhost:3000/auth/callback',
      AUTH_FRONTEND_ERROR_URL: 'http://localhost:3000/auth/error',
    });

    mockClient = {
      generateAuthUrl: jest.fn(),
      getToken: jest.fn(),
      verifyIdToken: jest.fn(),
    };

    adapter = new GoogleOAuthAdapter(envService, mockClient);
  });

  describe('generateAuthorizationUrl', () => {
    it('should generate authorization URL with openid email, PKCE S256, state, and nonce', () => {
      mockClient.generateAuthUrl.mockReturnValue(
        'https://accounts.google.com/o/oauth2/v2/auth?...',
      );

      const url = adapter.generateAuthorizationUrl({
        state: 'state-123',
        nonce: 'nonce-456',
        codeChallenge: 'challenge-789',
      });

      expect(url).toBe('https://accounts.google.com/o/oauth2/v2/auth?...');
      expect(mockClient.generateAuthUrl).toHaveBeenCalledWith({
        access_type: 'online',
        scope: ['openid', 'email'],
        state: 'state-123',
        nonce: 'nonce-456',
        code_challenge: 'challenge-789',
        code_challenge_method: 'S256',
        response_type: 'code',
        redirect_uri: 'http://localhost:4000/auth/google/callback',
        include_granted_scopes: false,
      });
    });
  });

  describe('exchangeAndVerify', () => {
    const validClaims = {
      sub: 'google-sub-12345',
      email: 'user@gmail.com',
      email_verified: true,
      iss: 'https://accounts.google.com',
      nonce: 'expected-nonce-999',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    it('should successfully exchange code and verify ID token claims', async () => {
      mockClient.getToken.mockResolvedValue({
        tokens: { id_token: 'valid.id.token' },
      });
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => validClaims,
      });

      const identity = await adapter.exchangeAndVerify({
        code: 'auth-code-123',
        codeVerifier: 'verifier-456',
        expectedNonce: 'expected-nonce-999',
      });

      expect(mockClient.getToken).toHaveBeenCalledWith({
        code: 'auth-code-123',
        codeVerifier: 'verifier-456',
        redirect_uri: 'http://localhost:4000/auth/google/callback',
      });
      expect(mockClient.verifyIdToken).toHaveBeenCalledWith({
        idToken: 'valid.id.token',
        audience: 'google-client-id-123',
      });
      expect(identity).toEqual({
        sub: 'google-sub-12345',
        email: 'user@gmail.com',
        emailVerified: true,
      });
    });

    it('should reject when nonce mismatches', async () => {
      mockClient.getToken.mockResolvedValue({
        tokens: { id_token: 'valid.id.token' },
      });
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({ ...validClaims, nonce: 'wrong-nonce' }),
      });

      await expect(
        adapter.exchangeAndVerify({
          code: 'code',
          codeVerifier: 'verifier',
          expectedNonce: 'expected-nonce-999',
        }),
      ).rejects.toThrow(InvalidGoogleIdentityException);
    });

    it('should reject when email_verified is false', async () => {
      mockClient.getToken.mockResolvedValue({
        tokens: { id_token: 'valid.id.token' },
      });
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({ ...validClaims, email_verified: false }),
      });

      await expect(
        adapter.exchangeAndVerify({
          code: 'code',
          codeVerifier: 'verifier',
          expectedNonce: 'expected-nonce-999',
        }),
      ).rejects.toThrow(/Email is not verified by Google/);
    });

    it('should reject non-ASCII or oversized provider subject (sub)', async () => {
      mockClient.getToken.mockResolvedValue({
        tokens: { id_token: 'valid.id.token' },
      });
      // Non-ASCII sub
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({ ...validClaims, sub: 'sub-with-đ' }),
      });

      await expect(
        adapter.exchangeAndVerify({
          code: 'code',
          codeVerifier: 'verifier',
          expectedNonce: 'expected-nonce-999',
        }),
      ).rejects.toThrow(InvalidGoogleIdentityException);

      // Oversized sub (> 255 chars)
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({ ...validClaims, sub: 'a'.repeat(256) }),
      });

      await expect(
        adapter.exchangeAndVerify({
          code: 'code',
          codeVerifier: 'verifier',
          expectedNonce: 'expected-nonce-999',
        }),
      ).rejects.toThrow(InvalidGoogleIdentityException);
    });

    it('should translate network / token exchange error to GoogleProviderUnavailableException safely', async () => {
      mockClient.getToken.mockRejectedValue(new Error('Network timeout'));

      await expect(
        adapter.exchangeAndVerify({
          code: 'code',
          codeVerifier: 'verifier',
          expectedNonce: 'expected-nonce-999',
        }),
      ).rejects.toThrow(GoogleProviderUnavailableException);
    });
  });
});
