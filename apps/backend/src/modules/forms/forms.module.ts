import { Logger, Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { EconomyModule } from '../economy/economy.module';
import { FormsController } from './presentation/forms.controller';
import { PublisherFormReadsController } from './presentation/publisher-form-reads.controller';
import { PublisherFormReadsService } from './application/publisher-form-reads.service';
import { PublicFormsController } from './presentation/public-forms.controller';
import { FormsService } from './application/forms.service';
import { FormsEscrowCoordinator } from './application/forms-escrow.coordinator';
import { FormModerationCommands } from './application/form-moderation.commands';
import {
  UNIT_OF_WORK_PORT,
  UnitOfWorkPort,
} from '../../common/database/unit-of-work.port';
import { PublicFormsService } from './application/public-forms.service';
import { CaptchaValidatorService } from './infrastructure/captcha-validator.service';
import { GuestSubmissionRateLimiter } from './infrastructure/guest-submission-rate-limiter';
import { LedgerService } from '../economy/application/ledger.service';
import { EnvService } from '../../common/config/env.service';
import {
  FORM_REPOSITORY_PORT,
  FormRepositoryPort,
} from './application/ports/form-repository.port';
import { PrismaFormRepository } from './infrastructure/prisma-form.repository';
import {
  COMPLETION_CODE_PORT,
  CompletionCodePort,
} from './application/ports/completion-code.port';
import { CompletionCodeService } from './infrastructure/completion-code.service';
import {
  SURVEY_RESPONSE_REPOSITORY_PORT,
  SurveyResponseRepositoryPort,
} from '../marketplace/application/ports/survey-response.repository.port';
import { PrismaSurveyResponseRepository } from '../marketplace/infrastructure/prisma-survey-response.repository';
import { AudienceEstimateController } from './presentation/audience-estimate.controller';
import { AudienceEstimateService } from './application/audience-estimate.service';
import {
  AUDIENCE_PROFILE_SOURCE_PORT,
  AudienceProfileSourcePort,
} from './application/ports/audience-profile-source.port';
import { PrismaAudienceProfileSource } from './infrastructure/prisma-audience-profile.source';
import { createHmac } from 'crypto';
import { SecurityModule } from '../../common/security/security.module';
import {
  RATE_LIMIT_COUNTER_STORE,
  RateLimitCounterStorePort,
} from '../../common/security/rate-limit-counter-store.port';
import { MODERATION_QUEUE_STATS_PORT } from './application/ports/moderation-queue-stats.port';
import { FORM_TITLE_LOOKUP_PORT } from './application/ports/form-title-lookup.port';
import { PUBLISHED_FORM_ADMIN_PORT } from './application/ports/published-form-admin.port';
import { PrismaFormAdminReads } from './infrastructure/prisma-form-admin-reads';
import {
  NOTIFICATION_PUBLISHER_PORT,
  NotificationPublisherPort,
} from '../notifications/application/ports/notification-publisher.port';
import { FormsSchedulerRegistrar } from './infrastructure/forms-scheduler.registrar';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    EconomyModule,
    SecurityModule,
  ],
  controllers: [
    FormsController,
    PublisherFormReadsController,
    PublicFormsController,
    AudienceEstimateController,
  ],
  providers: [
    // Admin read views (IR.4b part C, mock-off plan 4.1-4.3): Forms-owned reads.
    PrismaFormAdminReads,
    { provide: MODERATION_QUEUE_STATS_PORT, useExisting: PrismaFormAdminReads },
    { provide: FORM_TITLE_LOOKUP_PORT, useExisting: PrismaFormAdminReads },
    { provide: PUBLISHED_FORM_ADMIN_PORT, useExisting: PrismaFormAdminReads },
    {
      provide: FORM_REPOSITORY_PORT,
      useClass: PrismaFormRepository,
    },
    {
      provide: COMPLETION_CODE_PORT,
      useClass: CompletionCodeService,
    },
    {
      provide: SURVEY_RESPONSE_REPOSITORY_PORT,
      useClass: PrismaSurveyResponseRepository,
    },
    {
      // Bug 3.3: fails closed in production (no CAPTCHA provider integrated).
      provide: CaptchaValidatorService,
      useFactory: (env: EnvService) =>
        new CaptchaValidatorService({ isProduction: env.isProduction }),
      inject: [EnvService],
    },
    GuestSubmissionRateLimiter,
    {
      provide: AUDIENCE_PROFILE_SOURCE_PORT,
      useClass: PrismaAudienceProfileSource,
    },
    {
      provide: AudienceEstimateService,
      useFactory: (
        source: AudienceProfileSourcePort,
        env: EnvService,
        counterStore: RateLimitCounterStorePort,
      ) =>
        new AudienceEstimateService(source, {
          // Noise key derived from a server secret (no extra env variable).
          noiseKey: createHmac('sha256', env.jwtSecret)
            .update('rescom:audience-estimate-noise:v1')
            .digest('hex'),
          counterStore,
          logger: new Logger(AudienceEstimateService.name),
        }),
      inject: [
        AUDIENCE_PROFILE_SOURCE_PORT,
        EnvService,
        RATE_LIMIT_COUNTER_STORE,
      ],
    },
    {
      provide: FormsEscrowCoordinator,
      useFactory: (
        formRepo: FormRepositoryPort,
        ledgerService: LedgerService,
      ) =>
        new FormsEscrowCoordinator(
          formRepo,
          ledgerService,
          new Logger(FormsEscrowCoordinator.name),
        ),
      inject: [FORM_REPOSITORY_PORT, LedgerService],
    },
    {
      provide: FormsService,
      useFactory: (
        formRepository: FormRepositoryPort,
        completionCodePort: CompletionCodePort,
        escrowCoordinator: FormsEscrowCoordinator,
        unitOfWork: UnitOfWorkPort,
        notificationPublisher?: NotificationPublisherPort,
      ) =>
        new FormsService(
          formRepository,
          completionCodePort,
          escrowCoordinator,
          unitOfWork,
          notificationPublisher,
        ),
      inject: [
        FORM_REPOSITORY_PORT,
        COMPLETION_CODE_PORT,
        FormsEscrowCoordinator,
        UNIT_OF_WORK_PORT,
        // Story IR.2b Task 9.4: ESCROW_RELEASED after a deadline close.
        { token: NOTIFICATION_PUBLISHER_PORT, optional: true },
      ],
    },
    // Story IR.2b: the `deadline-close` scheduler job.
    FormsSchedulerRegistrar,
    {
      // Story IR.4a: owner-only progress and version detail (read-only).
      provide: PublisherFormReadsService,
      useFactory: (
        formRepository: FormRepositoryPort,
        escrowCoordinator: FormsEscrowCoordinator,
      ) => new PublisherFormReadsService(formRepository, escrowCoordinator),
      inject: [FORM_REPOSITORY_PORT, FormsEscrowCoordinator],
    },
    {
      provide: FormModerationCommands,
      useFactory: (
        formRepository: FormRepositoryPort,
        escrowCoordinator: FormsEscrowCoordinator,
      ) => new FormModerationCommands(formRepository, escrowCoordinator),
      inject: [FORM_REPOSITORY_PORT, FormsEscrowCoordinator],
    },
    {
      provide: PublicFormsService,
      useFactory: (
        formRepository: FormRepositoryPort,
        responseRepository: SurveyResponseRepositoryPort,
        captchaValidator: CaptchaValidatorService,
        rateLimiter: GuestSubmissionRateLimiter,
        formsService: FormsService,
      ) =>
        new PublicFormsService(
          formRepository,
          responseRepository,
          captchaValidator,
          rateLimiter,
          // Plan 2.3: a guest filling the last slot closes the survey too.
          formsService,
        ),
      inject: [
        FORM_REPOSITORY_PORT,
        SURVEY_RESPONSE_REPOSITORY_PORT,
        CaptchaValidatorService,
        GuestSubmissionRateLimiter,
        FormsService,
      ],
    },
  ],
  exports: [
    MODERATION_QUEUE_STATS_PORT,
    FORM_TITLE_LOOKUP_PORT,
    PUBLISHED_FORM_ADMIN_PORT,
    FormsService,
    FormModerationCommands,
    FORM_REPOSITORY_PORT,
    COMPLETION_CODE_PORT,
    PublicFormsService,
  ],
})
export class FormsModule {}
