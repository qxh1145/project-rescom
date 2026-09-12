import { ExecutionContext } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';
import { EnvService } from '../../../../common/config/env.service';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../cookie-options.helper';
import {
  UnauthorizedSessionException,
  InvalidTokenException,
  SessionExpiredException,
  SessionRevokedException,
  UserLockedException,
} from '../../application/exceptions/auth.exceptions';
import { Session } from '../../domain/session.entity';
import { User } from '../../../users/domain/user.entity';

describe('SessionAuthGuard (Task 3)', () => {
  let guard: SessionAuthGuard;
  let mockSessionService: any;
  let mockEnvService: any;

  beforeEach(() => {
    mockSessionService = {
      validateSession: jest.fn(),
    };
    mockEnvService = {
      isProduction: false,
      jwtAccessTtlSeconds: 900,
      sessionAbsoluteTtlSeconds: 2592000,
    };
    guard = new SessionAuthGuard(
      mockSessionService,
      mockEnvService as EnvService,
    );
  });

  function createMockExecutionContext(cookies: Record<string, string> = {}) {
    const req: any = {
      cookies,
    };
    const res: any = {
      clearCookie: jest.fn(),
      setHeader: jest.fn(),
    };
    const context: any = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    };
    return { context, req, res };
  }

  it('should clear cookies, set no-store, and throw UnauthorizedSessionException when access token is missing', async () => {
    const { context, res } = createMockExecutionContext({});

    await expect(
      guard.canActivate(context as ExecutionContext),
    ).rejects.toThrow(UnauthorizedSessionException);

    expect(res.clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('should attach sanitized AuthenticatedUser (no passwordHash) and session on success', async () => {
    const { context, req, res } = createMockExecutionContext({
      [AUTH_COOKIE_NAME]: 'valid-access-token',
    });

    const mockUser = new User({
      id: 'u-1',
      email: 'user@example.com',
      passwordHash: '$2a$12$secretHashMustNotBeLeaked',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });

    const mockSession = new Session({
      id: 's-1',
      userId: 'u-1',
      sessionVersion: 1,
      csrfDigest: 'csrf-dig',
      revoked: false,
      expiresAt: new Date(Date.now() + 10000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockSessionService.validateSession.mockResolvedValue({
      user: mockUser,
      session: mockSession,
    });

    const result = await guard.canActivate(context as ExecutionContext);

    expect(result).toBe(true);
    expect(req.user).toEqual({
      id: 'u-1',
      email: 'user@example.com',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });
    // Ensure passwordHash is strictly omitted
    expect((req.user as any).passwordHash).toBeUndefined();
    expect(req.session).toBe(mockSession);
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('should clear cookies, set no-store, and rethrow SessionRevokedException', async () => {
    const { context, res } = createMockExecutionContext({
      [AUTH_COOKIE_NAME]: 'revoked-token',
    });

    mockSessionService.validateSession.mockRejectedValue(
      new SessionRevokedException(),
    );

    await expect(
      guard.canActivate(context as ExecutionContext),
    ).rejects.toThrow(SessionRevokedException);

    expect(res.clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('should clear cookies, set no-store, and rethrow SessionExpiredException', async () => {
    const { context, res } = createMockExecutionContext({
      [AUTH_COOKIE_NAME]: 'expired-token',
    });

    mockSessionService.validateSession.mockRejectedValue(
      new SessionExpiredException(),
    );

    await expect(
      guard.canActivate(context as ExecutionContext),
    ).rejects.toThrow(SessionExpiredException);

    expect(res.clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('should clear cookies, set no-store, and rethrow UserLockedException', async () => {
    const { context, res } = createMockExecutionContext({
      [AUTH_COOKIE_NAME]: 'locked-user-token',
    });

    mockSessionService.validateSession.mockRejectedValue(
      new UserLockedException(),
    );

    await expect(
      guard.canActivate(context as ExecutionContext),
    ).rejects.toThrow(UserLockedException);

    expect(res.clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('should clear cookies, set no-store, and rethrow InvalidTokenException', async () => {
    const { context, res } = createMockExecutionContext({
      [AUTH_COOKIE_NAME]: 'invalid-signature-token',
    });

    mockSessionService.validateSession.mockRejectedValue(
      new InvalidTokenException('Signature invalid'),
    );

    await expect(
      guard.canActivate(context as ExecutionContext),
    ).rejects.toThrow(InvalidTokenException);

    expect(res.clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('should NOT clear cookies or set no-store on unexpected infrastructure errors', async () => {
    const { context, res } = createMockExecutionContext({
      [AUTH_COOKIE_NAME]: 'valid-looking-token',
    });

    const dbError = new Error('Database connection failed');
    mockSessionService.validateSession.mockRejectedValue(dbError);

    await expect(
      guard.canActivate(context as ExecutionContext),
    ).rejects.toThrow(dbError);

    // Client cookies must NOT be cleared when DB experiences temporary outage
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
