import { ExecutionContext } from '@nestjs/common';
import { EnvService } from '../../../../common/config/env.service';
import {
  ForbiddenOriginException,
  InvalidCsrfTokenException,
} from '../../application/exceptions/auth.exceptions';
import { SecretProtectionPort } from '../../application/ports/secret-protection.port';
import { Session } from '../../domain/session.entity';
import { CsrfGuard } from './csrf.guard';

describe('CsrfGuard', () => {
  const envService = {
    frontendOrigins: ['https://app.rescom.com.vn'],
  } as EnvService;
  const secretProtection = {
    verifyCsrfToken: jest.fn(
      (token: string, digest: string) => digest === `digest:${token}`,
    ),
  } as unknown as SecretProtectionPort;
  const guard = new CsrfGuard(envService, secretProtection);

  function context(headers: Record<string, string>, withSession = true) {
    const request: any = {
      headers,
      session: withSession
        ? new Session({
            id: 'session-id',
            userId: 'user-id',
            sessionVersion: 1,
            csrfDigest: 'digest:csrf-token',
            revoked: false,
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        : undefined,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
  }

  it('accepts an allowed origin with the current session CSRF token', () => {
    expect(
      guard.canActivate(
        context({
          origin: 'https://app.rescom.com.vn',
          'sec-fetch-site': 'same-site',
          'x-csrf-token': 'csrf-token',
        }),
      ),
    ).toBe(true);
  });

  it('rejects requests without an origin', () => {
    expect(() =>
      guard.canActivate(context({ 'x-csrf-token': 'csrf-token' })),
    ).toThrow(ForbiddenOriginException);
  });

  it('rejects a missing or invalid CSRF token', () => {
    expect(() =>
      guard.canActivate(context({ origin: 'https://app.rescom.com.vn' })),
    ).toThrow(InvalidCsrfTokenException);
    expect(() =>
      guard.canActivate(
        context({
          origin: 'https://app.rescom.com.vn',
          'x-csrf-token': 'wrong-token',
        }),
      ),
    ).toThrow(InvalidCsrfTokenException);
  });
});
