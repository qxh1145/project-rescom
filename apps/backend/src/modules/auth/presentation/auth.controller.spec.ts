import { AuthController } from './auth.controller';
import { AuthenticatedUser } from './types/authenticated-request.type';
import { UserLockedException } from '../application/exceptions/auth.exceptions';
import { AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME } from './cookie-options.helper';

describe('AuthController (Task 5)', () => {
  let controller: AuthController;
  let mockAuthService: any;
  let mockEnvService: any;
  let mockSessionService: any;

  beforeEach(() => {
    mockAuthService = {};
    mockEnvService = {
      isProduction: false,
      jwtAccessTtlSeconds: 900,
      sessionAbsoluteTtlSeconds: 2592000,
      frontendOrigins: ['http://localhost:3000'],
      authFrontendOrigins: ['http://localhost:3000'],
    };
    mockSessionService = {
      logout: jest.fn(),
      rotateCsrf: jest.fn(),
    };

    controller = new AuthController(
      mockAuthService,
      mockEnvService,
      mockSessionService,
    );
  });

  describe('GET /auth/csrf', () => {
    it('clears authentication cookies when a locked account is rejected', async () => {
      mockSessionService.rotateCsrf.mockRejectedValueOnce(
        new UserLockedException(),
      );
      const request: any = {
        headers: { origin: 'http://localhost:3000' },
        cookies: {
          [AUTH_COOKIE_NAME]: 'access-token',
          [REFRESH_COOKIE_NAME]: 'refresh-token',
        },
      };
      const response: any = { clearCookie: jest.fn() };

      await expect(controller.getCsrf(request, response)).rejects.toThrow(
        UserLockedException,
      );
      expect(response.clearCookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAME,
        expect.any(Object),
      );
      expect(response.clearCookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        expect.any(Object),
      );
    });
  });

  describe('GET /auth/me', () => {
    it('should return sanitized user data in standard API success envelope', async () => {
      const mockUser: AuthenticatedUser = {
        id: 'u-test-1',
        email: 'test@example.com',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      };

      const result = await controller.getMe(mockUser);

      expect(result).toEqual({
        data: {
          id: 'u-test-1',
          email: 'test@example.com',
          role: 'RESPONDENT',
          status: 'ACTIVE',
        },
        error: null,
        meta: {},
      });
      // Verify no sensitive fields like passwordHash exist
      expect((result.data as any).passwordHash).toBeUndefined();
    });
  });
});
