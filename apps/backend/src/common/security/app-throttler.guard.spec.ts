import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException, ThrottlerLimitDetail } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard';

describe('AppThrottlerGuard (Unit Tests)', () => {
  let guard: AppThrottlerGuard;
  let mockOptions: any;
  let mockStorage: any;
  let mockReflector: any;

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
    guard = new AppThrottlerGuard(mockOptions, mockStorage, mockReflector);
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
});
