import { Logger, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './application/auth.service';
import { SessionService } from './application/session.service';
import { GoogleOAuthService } from './application/google-oauth.service';
import { AuthController } from './presentation/auth.controller';
import { GoogleOAuthController } from './presentation/google-oauth.controller';
import { SessionAuthGuard } from './presentation/guards/session-auth.guard';
import { RolesGuard } from './presentation/guards/roles.guard';
import { CsrfGuard } from './presentation/guards/csrf.guard';
import {
  PASSWORD_HASHER_PORT,
  PasswordHasherPort,
} from './application/ports/password-hasher.port';
import {
  TOKEN_SERVICE_PORT,
  TokenServicePort,
} from './application/ports/token-service.port';
import {
  SECRET_PROTECTION_PORT,
  SecretProtectionPort,
} from './application/ports/secret-protection.port';
import {
  IDENTITY_AUDIT_PORT,
  IdentityAuditPort,
} from './application/ports/identity-audit.port';
import {
  SESSION_REPOSITORY_PORT,
  SessionRepositoryPort,
} from './application/ports/session-repository.port';
import {
  OAUTH_PROVIDER_PORT,
  OAuthProviderPort,
} from './application/ports/oauth-provider.port';
import {
  OAUTH_INTENT_REPOSITORY_PORT,
  OAuthIntentRepositoryPort,
} from './application/ports/oauth-intent-repository.port';
import {
  OAUTH_PERSISTENCE_PORT,
  OAuthPersistencePort,
} from './application/ports/oauth-persistence.port';
import { BcryptPasswordHasherAdapter } from './infrastructure/bcrypt-password-hasher.adapter';
import { NestJwtTokenAdapter } from './infrastructure/nest-jwt-token.adapter';
import { DerivedSecretProtectionAdapter } from './infrastructure/derived-secret-protection.adapter';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaIdentityAuditRepository } from './infrastructure/prisma-identity-audit.repository';
import { GoogleOAuthAdapter } from './infrastructure/google-oauth.adapter';
import { PrismaOAuthIntentRepository } from './infrastructure/prisma-oauth-intent.repository';
import { PrismaOAuthRepository } from './infrastructure/prisma-oauth.repository';
import { UsersModule } from '../users/users.module';
import {
  USER_REPOSITORY_PORT,
  UserRepositoryPort,
} from '../users/application/ports/user.repository.port';
import { EnvService } from '../../common/config/env.service';
import { StarterPointsCoordinator } from '../economy/application/starter-points.coordinator';
import { PasswordResetService } from './application/password-reset.service';
import {
  PASSWORD_RESET_REPOSITORY_PORT,
  PasswordResetRepositoryPort,
} from './application/ports/password-reset.repository.port';
import { PrismaPasswordResetRepository } from './infrastructure/prisma-password-reset.repository';
import { AuthSchedulerRegistrar } from './infrastructure/auth-scheduler.registrar';
import { SecurityModule } from '../../common/security/security.module';
import {
  RATE_LIMIT_COUNTER_STORE,
  RateLimitCounterStorePort,
} from '../../common/security/rate-limit-counter-store.port';
import {
  EMAIL_SENDER_PORT,
  EmailSenderPort,
} from '../notifications/application/ports/email-sender.port';

@Module({
  imports: [UsersModule, JwtModule.register({}), SecurityModule],
  controllers: [AuthController, GoogleOAuthController],
  providers: [
    {
      provide: PASSWORD_HASHER_PORT,
      useClass: BcryptPasswordHasherAdapter,
    },
    {
      provide: TOKEN_SERVICE_PORT,
      useClass: NestJwtTokenAdapter,
    },
    {
      provide: SECRET_PROTECTION_PORT,
      useClass: DerivedSecretProtectionAdapter,
    },
    {
      provide: IDENTITY_AUDIT_PORT,
      useClass: PrismaIdentityAuditRepository,
    },
    {
      provide: SESSION_REPOSITORY_PORT,
      useClass: PrismaSessionRepository,
    },
    {
      provide: OAUTH_PROVIDER_PORT,
      useFactory: (envService: EnvService) =>
        new GoogleOAuthAdapter(envService),
      inject: [EnvService],
    },
    {
      provide: OAUTH_INTENT_REPOSITORY_PORT,
      useClass: PrismaOAuthIntentRepository,
    },
    {
      provide: OAUTH_PERSISTENCE_PORT,
      useClass: PrismaOAuthRepository,
    },
    {
      provide: SessionService,
      useFactory: (
        sessionRepository: SessionRepositoryPort,
        userRepository: UserRepositoryPort,
        tokenService: TokenServicePort,
        secretProtection: SecretProtectionPort,
        identityAudit: IdentityAuditPort,
        envService: EnvService,
      ) =>
        new SessionService(
          sessionRepository,
          userRepository,
          tokenService,
          secretProtection,
          identityAudit,
          {
            jwtAccessTtlSeconds: envService.jwtAccessTtlSeconds,
            sessionAbsoluteTtlSeconds: envService.sessionAbsoluteTtlSeconds,
          },
        ),
      inject: [
        SESSION_REPOSITORY_PORT,
        USER_REPOSITORY_PORT,
        TOKEN_SERVICE_PORT,
        SECRET_PROTECTION_PORT,
        IDENTITY_AUDIT_PORT,
        EnvService,
      ],
    },
    {
      provide: GoogleOAuthService,
      useFactory: (
        oauthProvider: OAuthProviderPort,
        oauthIntentRepository: OAuthIntentRepositoryPort,
        oauthPersistence: OAuthPersistencePort,
        userRepository: UserRepositoryPort,
        passwordHasher: PasswordHasherPort,
        secretProtection: SecretProtectionPort,
        identityAudit: IdentityAuditPort,
        sessionService: SessionService,
        envService: EnvService,
        starterPointsCoordinator?: StarterPointsCoordinator,
      ) =>
        new GoogleOAuthService(
          oauthProvider,
          oauthIntentRepository,
          oauthPersistence,
          userRepository,
          passwordHasher,
          secretProtection,
          identityAudit,
          sessionService,
          {
            oauthIntentTtlSeconds: envService.oauthIntentTtlSeconds,
            frontendSuccessUrl: envService.authFrontendSuccessUrl,
            frontendErrorUrl: envService.authFrontendErrorUrl,
          },
          undefined,
          undefined,
          starterPointsCoordinator,
        ),
      inject: [
        OAUTH_PROVIDER_PORT,
        OAUTH_INTENT_REPOSITORY_PORT,
        OAUTH_PERSISTENCE_PORT,
        USER_REPOSITORY_PORT,
        PASSWORD_HASHER_PORT,
        SECRET_PROTECTION_PORT,
        IDENTITY_AUDIT_PORT,
        SessionService,
        EnvService,
        { token: StarterPointsCoordinator, optional: true },
      ],
    },
    {
      provide: AuthService,
      useFactory: (
        userRepository: UserRepositoryPort,
        passwordHasher: PasswordHasherPort,
        tokenService: TokenServicePort,
        sessionService: SessionService,
        starterPointsCoordinator?: StarterPointsCoordinator,
      ) =>
        new AuthService(
          userRepository,
          passwordHasher,
          tokenService,
          undefined,
          sessionService,
          starterPointsCoordinator,
        ),
      inject: [
        USER_REPOSITORY_PORT,
        PASSWORD_HASHER_PORT,
        TOKEN_SERVICE_PORT,
        SessionService,
        { token: StarterPointsCoordinator, optional: true },
      ],
    },
    {
      provide: PASSWORD_RESET_REPOSITORY_PORT,
      useClass: PrismaPasswordResetRepository,
    },
    {
      // Plan 5.4. The sender comes from the global NotificationsModule
      // (optional: a test module without it still builds).
      provide: PasswordResetService,
      useFactory: (
        userRepository: UserRepositoryPort,
        resets: PasswordResetRepositoryPort,
        passwordHasher: PasswordHasherPort,
        envService: EnvService,
        counters: RateLimitCounterStorePort,
        emailSender?: EmailSenderPort,
      ) =>
        new PasswordResetService(
          userRepository,
          resets,
          passwordHasher,
          emailSender,
          counters,
          {
            appBaseUrl: envService.emailAppBaseUrl,
            minimumRequestMs: envService.isTest ? 0 : 400,
          },
          new Logger(PasswordResetService.name),
        ),
      inject: [
        USER_REPOSITORY_PORT,
        PASSWORD_RESET_REPOSITORY_PORT,
        PASSWORD_HASHER_PORT,
        EnvService,
        RATE_LIMIT_COUNTER_STORE,
        { token: EMAIL_SENDER_PORT, optional: true },
      ],
    },
    AuthSchedulerRegistrar,
    SessionAuthGuard,
    RolesGuard,
    CsrfGuard,
  ],
  exports: [
    AuthService,
    SessionService,
    SessionAuthGuard,
    RolesGuard,
    CsrfGuard,
    GoogleOAuthService,
    TOKEN_SERVICE_PORT,
    SECRET_PROTECTION_PORT,
    SESSION_REPOSITORY_PORT,
    IDENTITY_AUDIT_PORT,
    OAUTH_PROVIDER_PORT,
    OAUTH_INTENT_REPOSITORY_PORT,
    OAUTH_PERSISTENCE_PORT,
  ],
})
export class AuthModule {}
