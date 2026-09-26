import { ExecutionContext } from '@nestjs/common';
import { EnvService } from '../../../../common/config/env.service';
import {
  ForbiddenOriginException,
  InvalidCsrfTokenException,
} from '../../application/exceptions/auth.exceptions';
import { SecretProtectionPort } from '../../application/ports/secret-protection.port';
import { Session } from '../../domain/session.entity';
import { OptionalSessionCsrfGuard } from './optional-session-csrf.guard';

describe('OptionalSessionCsrfGuard (Epic 5 review P12)', () => {
  const envService = {
    frontendOrigins: ['https://app.rescom.com.vn'],
  } as EnvService;
  const secretProtection = {
    verifyCsrfToken: jest.fn(
      (token: string, digest: string) => digest === `digest:${token}`,
    ),
  } as unknown as SecretProtectionPort;
  const guard = new OptionalSessionCsrfGuard(envService, secretProtection);

  function context(headers: Record<string, string>, withSession: boolean) {
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

  describe('with a session', () => {
    it('accepts an allowed origin with the session CSRF token', () => {
      expect(
        guard.canActivate(
          context(
            {
              origin: 'https://app.rescom.com.vn',
              'x-csrf-token': 'csrf-token',
            },
            true,
          ),
        ),
      ).toBe(true);
    });

    it('rejects a missing or wrong CSRF token', () => {
      expect(() =>
        guard.canActivate(
          context({ origin: 'https://app.rescom.com.vn' }, true),
        ),
      ).toThrow(InvalidCsrfTokenException);
      expect(() =>
        guard.canActivate(
          context(
            {
              origin: 'https://app.rescom.com.vn',
              'x-csrf-token': 'wrong-token',
            },
            true,
          ),
        ),
      ).toThrow(InvalidCsrfTokenException);
    });
  });

  describe('as a guest', () => {
    it('accepts an allowed origin without a token', () => {
      expect(
        guard.canActivate(
          context({ origin: 'https://app.rescom.com.vn' }, false),
        ),
      ).toBe(true);
    });

    it('rejects a request without Origin or Referer', () => {
      expect(() => guard.canActivate(context({}, false))).toThrow(
        ForbiddenOriginException,
      );
    });

    it('rejects a foreign origin', () => {
      expect(() =>
        guard.canActivate(context({ origin: 'https://evil.example' }, false)),
      ).toThrow(ForbiddenOriginException);
    });
  });
});
