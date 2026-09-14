import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter (Unit Tests)', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  function createMockHost(mockResponse: any): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({}),
      }),
    } as any;
  }

  it('should map ThrottlerException to HTTP 429 with standard RATE_LIMIT_EXCEEDED envelope', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    const mockResponse = {
      status: mockStatus,
      headersSent: false,
    };

    const host = createMockHost(mockResponse);
    const exception = new ThrottlerException(
      'Too many requests. Please try again later.',
    );

    filter.catch(exception, host);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(mockJson).toHaveBeenCalledWith({
      data: null,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
      meta: {},
    });
  });

  it('should do nothing if response.headersSent is true', () => {
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    const mockResponse = {
      status: mockStatus,
      headersSent: true,
    };

    const host = createMockHost(mockResponse);
    const exception = new ThrottlerException('Blocked');

    filter.catch(exception, host);

    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockJson).not.toHaveBeenCalled();
  });
});
