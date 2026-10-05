import { Inject, Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerException,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import {
  TOKEN_SERVICE_PORT,
  TokenServicePort,
} from '../../modules/auth/application/ports/token-service.port';
import { AUTH_COOKIE_NAME } from '../../modules/auth/presentation/cookie-options.helper';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(TOKEN_SERVICE_PORT)
    private readonly tokenService: TokenServicePort,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Plan 0.1: a request whose access-token cookie passes the JWT signature
   * and expiry check is tracked per user, so users sharing one IP (every
   * browser behind the Next.js `/api` proxy) get their own buckets. Missing,
   * expired or forged tokens fall back to `req.ip`, so a made-up cookie never
   * opens a fresh bucket. Same token verification as `SessionAuthGuard`,
   * without its session lookup: no database query per request.
   *
   * Review MEDIUM-3 (accepted for now): the default buckets are per user, so
   * one IP holding K accounts gets K times the budget. A per-IP ceiling on
   * top of the per-user buckets is a pilot follow-up.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const accessToken: unknown = req.cookies?.[AUTH_COOKIE_NAME];
    if (typeof accessToken === 'string' && accessToken.length > 0) {
      try {
        const { sub } = await this.tokenService.verifyToken(accessToken);
        if (typeof sub === 'string' && sub.length > 0) {
          return `user:${sub}`;
        }
      } catch {
        // Unverifiable token: track the client IP below.
      }
    }
    return super.getTracker(req);
  }

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
