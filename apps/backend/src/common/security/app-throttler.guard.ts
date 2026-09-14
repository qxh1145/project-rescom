import { Injectable, ExecutionContext } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerException,
  ThrottlerLimitDetail,
} from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse();
    if (res && typeof res.header === 'function') {
      res.header(
        'Retry-After',
        Math.ceil(throttlerLimitDetail.timeToBlockExpire),
      );
      res.header('X-RateLimit-Limit', throttlerLimitDetail.limit);
      res.header('X-RateLimit-Remaining', 0);
      res.header('X-RateLimit-Reset', throttlerLimitDetail.timeToExpire);
    }
    throw new ThrottlerException('Too many requests. Please try again later.');
  }
}
