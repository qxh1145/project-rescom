import { EnvService } from '../../../common/config/env.service';
import {
  getAuthCookieOptions,
  getAuthClearCookieOptions,
  getRefreshCookieOptions,
  getRefreshClearCookieOptions,
  getOAuthIntentCookieOptions,
  getOAuthIntentClearCookieOptions,
  clearAuthCookies,
  clearLegacyAuthCookies,
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  OAUTH_INTENT_COOKIE_NAME,
} from './cookie-options.helper';

describe('Cookie Options Helper (AC6)', () => {
  it('should generate cookie options with secure: false in development/test', () => {
    const envService = new EnvService({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5433/db',
      JWT_SECRET: '01234567890123456789012345678901',
      JWT_ACCESS_TTL_SECONDS: 900,
    });

    const options = getAuthCookieOptions(envService);
    expect(options).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 900000,
    });
  });

  it('should generate cookie options with secure: true in production', () => {
    const envService = new EnvService({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5433/db',
      JWT_SECRET: '01234567890123456789012345678901',
      AUTH_SECRET_PROTECTION_KEY: '01234567890123456789012345678901',
      JWT_ACCESS_TTL_SECONDS: 900,
      GOOGLE_CLIENT_ID: 'production-google-client-id',
      GOOGLE_CLIENT_SECRET: 'production-google-client-secret',
      FRONTEND_ORIGINS: 'https://app.rescom.io',
      GOOGLE_REDIRECT_URI: 'https://api.rescom.io/auth/google/callback',
      AUTH_FRONTEND_SUCCESS_URL: 'https://app.rescom.io/callback',
      AUTH_FRONTEND_ERROR_URL: 'https://app.rescom.io/error',
      TRUST_PROXY_HOPS: 1,
      STORAGE_ACCESS_KEY_ID: 'prod-access-key',
      STORAGE_SECRET_ACCESS_KEY: 'prod-secret-key-12345',
      TOPUP_BANK_ACCOUNT_NUMBER: '1234567890',
      TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
      PARTICIPATION_RATE_LIMIT_POLICY_VERSION: 'participation-rate-limit-v1',
    });

    const options = getAuthCookieOptions(envService);
    expect(options.secure).toBe(true);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(900000);
  });

  it('should omit maxAge when clearing cookies', () => {
    const envService = new EnvService({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5433/db',
      JWT_SECRET: '01234567890123456789012345678901',
      AUTH_SECRET_PROTECTION_KEY: '01234567890123456789012345678901',
      GOOGLE_CLIENT_ID: 'production-google-client-id',
      GOOGLE_CLIENT_SECRET: 'production-google-client-secret',
      FRONTEND_ORIGINS: 'https://app.rescom.io',
      GOOGLE_REDIRECT_URI: 'https://api.rescom.io/auth/google/callback',
      AUTH_FRONTEND_SUCCESS_URL: 'https://app.rescom.io/callback',
      AUTH_FRONTEND_ERROR_URL: 'https://app.rescom.io/error',
      TRUST_PROXY_HOPS: 1,
      STORAGE_ACCESS_KEY_ID: 'prod-access-key',
      STORAGE_SECRET_ACCESS_KEY: 'prod-secret-key-12345',
      TOPUP_BANK_ACCOUNT_NUMBER: '1234567890',
      TOPUP_BANK_ACCOUNT_NAME: 'CONG TY RESCOM',
      PARTICIPATION_RATE_LIMIT_POLICY_VERSION: 'participation-rate-limit-v1',
    });

    const clearOptions = getAuthClearCookieOptions(envService);
    expect(clearOptions.secure).toBe(true);
    expect(clearOptions.httpOnly).toBe(true);
    expect(clearOptions.sameSite).toBe('lax');
    expect(clearOptions.path).toBe('/');
    expect(clearOptions.maxAge).toBeUndefined();
  });

  it('should generate refresh cookie options scoped to / so both /auth and /api/auth receive it', () => {
    const envService = new EnvService({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5433/db',
      JWT_SECRET: '01234567890123456789012345678901',
      SESSION_ABSOLUTE_TTL_SECONDS: 2592000,
    });

    const options = getRefreshCookieOptions(envService);
    expect(options.path).toBe('/');
    expect(options.httpOnly).toBe(true);
    expect(options.maxAge).toBe(2592000 * 1000);

    const clear = getRefreshClearCookieOptions(envService);
    expect(clear.path).toBe('/');
    expect(clear.maxAge).toBeUndefined();
  });

  it('should generate oauth intent cookie options scoped to / so initiation and callback both receive it', () => {
    const envService = new EnvService({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5433/db',
      JWT_SECRET: '01234567890123456789012345678901',
      OAUTH_INTENT_TTL_SECONDS: 600,
    });

    const options = getOAuthIntentCookieOptions(envService);
    expect(options.path).toBe('/');
    expect(options.httpOnly).toBe(true);
    expect(options.maxAge).toBe(600 * 1000);

    const clear = getOAuthIntentClearCookieOptions(envService);
    expect(clear.path).toBe('/');
    expect(clear.maxAge).toBeUndefined();
  });

  describe('cookie clearing', () => {
    const envService = new EnvService({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5433/db',
      JWT_SECRET: '01234567890123456789012345678901',
    });

    it('should expire cookies left at the legacy /auth and /auth/google/callback paths', () => {
      const res: any = { clearCookie: jest.fn() };

      clearLegacyAuthCookies(res, envService);

      expect(res.clearCookie).toHaveBeenCalledTimes(2);
      expect(res.clearCookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        expect.objectContaining({ path: '/auth', httpOnly: true }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        OAUTH_INTENT_COOKIE_NAME,
        expect.objectContaining({
          path: '/auth/google/callback',
          httpOnly: true,
        }),
      );
    });

    it('should clear auth cookies at the root path and at the legacy refresh path', () => {
      const res: any = { clearCookie: jest.fn() };

      clearAuthCookies(res, envService);

      expect(res.clearCookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAME,
        expect.objectContaining({ path: '/' }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        expect.objectContaining({ path: '/' }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        expect.objectContaining({ path: '/auth' }),
      );
    });
  });
});
