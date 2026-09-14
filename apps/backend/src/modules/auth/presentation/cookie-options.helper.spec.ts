import { EnvService } from '../../../common/config/env.service';
import {
  getAuthCookieOptions,
  getAuthClearCookieOptions,
  getRefreshCookieOptions,
  getRefreshClearCookieOptions,
  getOAuthIntentCookieOptions,
  getOAuthIntentClearCookieOptions,
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
    });

    const clearOptions = getAuthClearCookieOptions(envService);
    expect(clearOptions.secure).toBe(true);
    expect(clearOptions.httpOnly).toBe(true);
    expect(clearOptions.sameSite).toBe('lax');
    expect(clearOptions.path).toBe('/');
    expect(clearOptions.maxAge).toBeUndefined();
  });

  it('should generate refresh cookie options scoped to /auth', () => {
    const envService = new EnvService({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5433/db',
      JWT_SECRET: '01234567890123456789012345678901',
      SESSION_ABSOLUTE_TTL_SECONDS: 2592000,
    });

    const options = getRefreshCookieOptions(envService);
    expect(options.path).toBe('/auth');
    expect(options.httpOnly).toBe(true);
    expect(options.maxAge).toBe(2592000 * 1000);

    const clear = getRefreshClearCookieOptions(envService);
    expect(clear.path).toBe('/auth');
    expect(clear.maxAge).toBeUndefined();
  });

  it('should generate oauth intent cookie options scoped to /auth/google/callback', () => {
    const envService = new EnvService({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5433/db',
      JWT_SECRET: '01234567890123456789012345678901',
      OAUTH_INTENT_TTL_SECONDS: 600,
    });

    const options = getOAuthIntentCookieOptions(envService);
    expect(options.path).toBe('/auth/google/callback');
    expect(options.httpOnly).toBe(true);
    expect(options.maxAge).toBe(600 * 1000);

    const clear = getOAuthIntentClearCookieOptions(envService);
    expect(clear.path).toBe('/auth/google/callback');
    expect(clear.maxAge).toBeUndefined();
  });
});
