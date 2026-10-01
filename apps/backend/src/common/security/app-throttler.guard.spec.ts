import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException, ThrottlerLimitDetail } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard';
import { AUTH_COOKIE_NAME } from '../../modules/auth/presentation/cookie-options.helper';
import {
  InvalidTokenException,
  SessionExpiredException,
} from '../../modules/auth/application/exceptions/auth.exceptions';

describe('AppThrottlerGuard (Unit Tests)', () => {
  let guard: AppThrottlerGuard;
  let mockOptions: any;
  let mockStorage: any;
  let mockReflector: any;
  let mockTokenService: { signToken: jest.Mock; verifyToken: jest.Mock };

  beforeEach(() => {
    mockOptions = [
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
    ];
    mockStorage = {
      increment: jest.fn(),
    };
    mockReflector = {
      getAllAndOverride: jest.fn(),
    };
    mockTokenService = {
      signToken: jest.fn(),
      verifyToken: jest.fn(),
    };
    guard = new AppThrottlerGuard(
      mockOptions,
      mockStorage,
      mockReflector,
      mockTokenService,
    );
  });

  it('should set Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers and throw ThrottlerException', async () => {
    const headers: Record<string, any> = {};
    const mockResponse = {
      header: jest.fn((name: string, value: any) => {
        headers[name] = value;
      }),
    };

    const mockContext: ExecutionContext = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({}),
      }),
    } as any;

    const limitDetail: ThrottlerLimitDetail = {
      limit: 10,
      ttl: 60000,
      key: 'test-key',
      tracker: '127.0.0.1',
      totalHits: 11,
      timeToExpire: 45,
      isBlocked: true,
      timeToBlockExpire: 44.2,
    };

    // Access protected method for unit verification
    await expect(
      (guard as any).throwThrottlingException(mockContext, limitDetail),
    ).rejects.toThrow(
      new ThrottlerException('Too many requests. Please try again later.'),
    );

    expect(mockResponse.header).toHaveBeenCalledWith('Retry-After', 45);
    expect(mockResponse.header).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    expect(mockResponse.header).toHaveBeenCalledWith(
      'X-RateLimit-Remaining',
      0,
    );
    expect(mockResponse.header).toHaveBeenCalledWith('X-RateLimit-Reset', 45);
  });

  describe('getTracker (plan 0.1: per-user buckets behind a shared IP)', () => {
    const getTracker = (req: Record<string, any>): Promise<string> =>
      (guard as any).getTracker(req);

    it('tracks a request with a verified access token by its user id', async () => {
      mockTokenService.verifyToken.mockResolvedValue({
        sub: 'user-1',
        sessionId: 'session-1',
        sessionVersion: 1,
      });

      await expect(
        getTracker({
          ip: '127.0.0.1',
          cookies: { [AUTH_COOKIE_NAME]: 'signed.jwt.token' },
        }),
      ).resolves.toBe('user:user-1');
      expect(mockTokenService.verifyToken).toHaveBeenCalledWith(
        'signed.jwt.token',
      );
    });

    it('tracks an anonymous request by IP without verifying anything', async () => {
      await expect(
        getTracker({ ip: '203.0.113.7', cookies: {} }),
      ).resolves.toBe('203.0.113.7');
      await expect(getTracker({ ip: '203.0.113.7' })).resolves.toBe(
        '203.0.113.7',
      );
      expect(mockTokenService.verifyToken).not.toHaveBeenCalled();
    });

    it.each([
      ['a forged or malformed token', new InvalidTokenException('bad')],
      ['an expired token', new SessionExpiredException()],
    ])('falls back to the IP for %s', async (_label, error) => {
      mockTokenService.verifyToken.mockRejectedValue(error);

      await expect(
        getTracker({
          ip: '203.0.113.7',
          cookies: { [AUTH_COOKIE_NAME]: 'unverifiable' },
        }),
      ).resolves.toBe('203.0.113.7');
    });

    it('falls back to the IP when a verified token carries no subject', async () => {
      mockTokenService.verifyToken.mockResolvedValue({ sub: '' });

      await expect(
        getTracker({
          ip: '203.0.113.7',
          cookies: { [AUTH_COOKIE_NAME]: 'no-subject' },
        }),
      ).resolves.toBe('203.0.113.7');
    });

    it('ignores a non-string or empty access cookie', async () => {
      await expect(
        getTracker({
          ip: '203.0.113.7',
          cookies: { [AUTH_COOKIE_NAME]: ['a', 'b'] },
        }),
      ).resolves.toBe('203.0.113.7');
      await expect(
        getTracker({ ip: '203.0.113.7', cookies: { [AUTH_COOKIE_NAME]: '' } }),
      ).resolves.toBe('203.0.113.7');
      expect(mockTokenService.verifyToken).not.toHaveBeenCalled();
    });
  });
});
