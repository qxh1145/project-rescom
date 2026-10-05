import { Module, ExecutionContext } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '../config/config.module';
import { EnvService } from '../config/env.service';
import { RATE_LIMIT_COUNTER_STORE } from './rate-limit-counter-store.port';
import { InMemoryRateLimitCounterStore } from './in-memory-rate-limit-counter.store';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => {
        const defaultLimit =
          env.isTest && env.rateLimitMaxRequests === 100
            ? 10000
            : env.rateLimitMaxRequests;
        const authLimit =
          env.isTest && env.authRateLimitMaxRequests === 10
            ? 10000
            : env.authRateLimitMaxRequests;

        return [
          {
            name: 'default',
            ttl: env.rateLimitTtlSeconds * 1000,
            limit: defaultLimit,
          },
          // Credential endpoints only: AuthController / GoogleOAuthController
          // handlers without `@SkipThrottle({ auth: true })` (session reads,
          // CSRF bootstrap, refresh and logout stay on `default`).
          {
            name: 'auth',
            ttl: env.authRateLimitTtlSeconds * 1000,
            limit: authLimit,
            // Always the client IP, never the per-user tracker of
            // AppThrottlerGuard: a session cookie must not open a fresh
            // login/register bucket for each account an attacker holds.
            getTracker: (req: Record<string, any>) => req.ip,
            skipIf: (context: ExecutionContext) => {
              const classRef = context.getClass();
              const className = classRef?.name || '';
              return (
                className !== 'AuthController' &&
                className !== 'GoogleOAuthController'
              );
            },
          },
        ];
      },
    }),
  ],
  // AppThrottlerGuard is registered as APP_GUARD by AppModule, where the
  // AuthModule token service it verifies access tokens with is visible.
  providers: [
    // Story 8.2 / AD-6: single swap point for the per-user burst counters.
    // `REDIS_DISABLED_SINGLE_REPLICA` (the only profile the env schema accepts
    // today) binds the per-process store; a Redis store replaces this factory.
    {
      provide: RATE_LIMIT_COUNTER_STORE,
      useFactory: () => new InMemoryRateLimitCounterStore(),
    },
  ],
  exports: [ThrottlerModule, RATE_LIMIT_COUNTER_STORE],
})
export class SecurityModule {}
