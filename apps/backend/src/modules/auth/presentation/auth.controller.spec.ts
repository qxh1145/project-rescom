import { AuthController } from './auth.controller';
import { AuthenticatedUser } from './types/authenticated-request.type';

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
      authFrontendOrigins: ['http://localhost:3000'],
    };
    mockSessionService = {
      logout: jest.fn(),
    };

    controller = new AuthController(
      mockAuthService,
      mockEnvService,
      mockSessionService,
    );
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
