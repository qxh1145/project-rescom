import { Module, ExecutionContext } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '../config/config.module';
import { EnvService } from '../config/env.service';
import { AppThrottlerGuard } from './app-throttler.guard';

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
          {
            name: 'auth',
            ttl: env.authRateLimitTtlSeconds * 1000,
            limit: authLimit,
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
  providers: [AppThrottlerGuard],
  exports: [ThrottlerModule, AppThrottlerGuard],
})
export class SecurityModule {}
