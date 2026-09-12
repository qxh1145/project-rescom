import { CookieOptions, Response } from 'express';
import { EnvService } from '../../../common/config/env.service';

export const AUTH_COOKIE_NAME = 'rescom_access_token';
export const REFRESH_COOKIE_NAME = 'rescom_refresh_token';
export const OAUTH_INTENT_COOKIE_NAME = 'rescom_oauth_intent';

export function getAuthCookieOptions(
  envService: EnvService,
  options?: { isClear?: boolean },
): CookieOptions {
  const isClear = options?.isClear ?? false;
  return {
    httpOnly: true,
    secure: envService.isProduction,
    sameSite: 'lax',
    path: '/',
    ...(isClear ? {} : { maxAge: envService.jwtAccessTtlSeconds * 1000 }),
  };
}

export function getAuthClearCookieOptions(
  envService: EnvService,
): CookieOptions {
  return getAuthCookieOptions(envService, { isClear: true });
}

export function getRefreshCookieOptions(
  envService: EnvService,
  options?: { isClear?: boolean },
): CookieOptions {
  const isClear = options?.isClear ?? false;
  return {
    httpOnly: true,
    secure: envService.isProduction,
    sameSite: 'lax',
    path: '/auth',
    ...(isClear ? {} : { maxAge: envService.sessionAbsoluteTtlSeconds * 1000 }),
  };
}

export function getRefreshClearCookieOptions(
  envService: EnvService,
): CookieOptions {
  return getRefreshCookieOptions(envService, { isClear: true });
}

export function getOAuthIntentCookieOptions(
  envService: EnvService,
  options?: { isClear?: boolean },
): CookieOptions {
  const isClear = options?.isClear ?? false;
  return {
    httpOnly: true,
    secure: envService.isProduction,
    sameSite: 'lax',
    path: '/auth/google/callback',
    ...(isClear ? {} : { maxAge: envService.oauthIntentTtlSeconds * 1000 }),
  };
}

export function getOAuthIntentClearCookieOptions(
  envService: EnvService,
): CookieOptions {
  return getOAuthIntentCookieOptions(envService, { isClear: true });
}

export function clearAuthCookies(res: Response, envService: EnvService): void {
  res.clearCookie(AUTH_COOKIE_NAME, getAuthClearCookieOptions(envService));
  res.clearCookie(
    REFRESH_COOKIE_NAME,
    getRefreshClearCookieOptions(envService),
  );
}
