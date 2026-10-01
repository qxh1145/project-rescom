import { Logger, Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import {
  UNIT_OF_WORK_PORT,
  UnitOfWorkPort,
} from '../../common/database/unit-of-work.port';
import { AuthModule } from '../auth/auth.module';
import { FormsModule } from '../forms/forms.module';
import { UsersModule } from '../users/users.module';
import { ParticipationController } from './presentation/participation.controller';
import { ParticipationService } from './application/participation.service';
import { PARTICIPATION_REPOSITORY_PORT } from './application/ports/participation-repository.port';
import { PrismaParticipationRepository } from './infrastructure/prisma-participation.repository';
import {
  FORM_REPOSITORY_PORT,
  FormRepositoryPort,
} from '../forms/application/ports/form-repository.port';
import {
  DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
  DemographicProfileRepositoryPort,
} from '../users/application/ports/demographic-profile.repository.port';
import { ParticipationRepositoryPort } from './application/ports/participation-repository.port';

import { EconomyModule } from '../economy/economy.module';
import { RewardSettlementCoordinator } from '../economy/application/reward-settlement.coordinator';
import { StarterPointsCoordinator } from '../economy/application/starter-points.coordinator';
import {
  COMPLETION_CODE_PORT,
  CompletionCodePort,
} from '../forms/application/ports/completion-code.port';
import {
  NOTIFICATION_PUBLISHER_PORT,
  NotificationPublisherPort,
} from '../notifications/application/ports/notification-publisher.port';
import { SecurityModule } from '../../common/security/security.module';
import {
  RATE_LIMIT_COUNTER_STORE,
  RateLimitCounterStorePort,
} from '../../common/security/rate-limit-counter-store.port';
import { EnvService } from '../../common/config/env.service';
import { ParticipationRateLimiter } from './application/participation-rate-limiter';
import {
  SURVEY_FEEDBACK_REPOSITORY_PORT,
  SurveyFeedbackRepositoryPort,
} from './application/ports/survey-feedback-repository.port';
import { SurveyFeedbackService } from './application/survey-feedback.service';
import { PrismaSurveyFeedbackRepository } from './infrastructure/prisma-survey-feedback.repository';
import { SurveyFeedbackController } from './presentation/survey-feedback.controller';
import { AdminRewardRedriveController } from './presentation/admin-reward-redrive.controller';
import { AdminCompletionCodeLimitController } from './presentation/admin-completion-code-limit.controller';
import { SurveyRunnerReadService } from './application/survey-runner-read.service';
import { SurveyRunnerController } from './presentation/survey-runner.controller';
import { economyAttemptRewardQueries } from './infrastructure/economy-attempt-reward-query.adapter';
import {
  INTEGRITY_CONSENT_REPOSITORY_PORT,
  IntegrityConsentRepositoryPort,
} from './application/ports/integrity-consent-repository.port';
import { IntegrityConsentService } from './application/integrity-consent.service';
import { PrismaIntegrityConsentRepository } from './infrastructure/prisma-integrity-consent.repository';
import { IntegrityConsentController } from './presentation/integrity-consent.controller';
import {
  PUBLISHER_RESPONSE_READ_PORT,
  PublisherResponseReadPort,
} from './application/ports/publisher-response-read.port';
import { PublisherResultsService } from './application/publisher-results.service';
import { PrismaPublisherResponseReadRepository } from './infrastructure/prisma-publisher-response-read.repository';
import { PublisherResultsController } from './presentation/publisher-results.controller';
import { FRAUD_LOG_READ_PORT } from './application/ports/fraud-log-read.port';
import { PrismaFraudLogReader } from './infrastructure/prisma-fraud-log-reader';
import { MISSING_CODE_REPORT_STATS_PORT } from './application/ports/missing-code-report-stats.port';
import { PrismaMissingCodeReportStats } from './infrastructure/prisma-missing-code-report-stats';
import { FormsService } from '../forms/application/forms.service';
import { ParticipationSchedulerRegistrar } from './infrastructure/participation-scheduler.registrar';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    FormsModule,
    UsersModule,
    EconomyModule,
    SecurityModule,
  ],
  controllers: [
    ParticipationController,
    SurveyFeedbackController,
    AdminRewardRedriveController,
    // Decision E5-D1: Admin recovery of the completion-code limit.
    AdminCompletionCodeLimitController,
    // Story IR.2a: survey runner reads (API-01..05) and the cancel command.
    SurveyRunnerController,
    // Integrity telemetry notice (Figma 14), Integrity-owned consent records.
    IntegrityConsentController,
    // Story IR.4a: Publisher responses and analytics (owner-only reads).
    PublisherResultsController,
  ],
  providers: [
    // Admin FraudLog view (mock-off plan 4.2): read side of `fraud_logs`.
    { provide: FRAUD_LOG_READ_PORT, useClass: PrismaFraudLogReader },
    // Admin overview (IR.4b part C): open missing-code reports.
    {
      provide: MISSING_CODE_REPORT_STATS_PORT,
      useClass: PrismaMissingCodeReportStats,
    },
    {
      provide: PARTICIPATION_REPOSITORY_PORT,
      useClass: PrismaParticipationRepository,
    },
    {
      // Story 8.2 (FR-46): central policy from env; burst counters from the
      // SecurityModule store (per-process now, Redis for REDIS_SHARED).
      provide: ParticipationRateLimiter,
      useFactory: (
        counterStore: RateLimitCounterStorePort,
        participationRepository: ParticipationRepositoryPort,
        env: EnvService,
      ) =>
        new ParticipationRateLimiter(
          counterStore,
          participationRepository,
          env.participationRateLimitPolicy,
        ),
      inject: [
        RATE_LIMIT_COUNTER_STORE,
        PARTICIPATION_REPOSITORY_PORT,
        EnvService,
      ],
    },
    {
      provide: ParticipationService,
      useFactory: (
        formRepository: FormRepositoryPort,
        demographicRepository: DemographicProfileRepositoryPort,
        participationRepository: ParticipationRepositoryPort,
        rewardSettlementCoordinator: RewardSettlementCoordinator,
        completionCodePort: CompletionCodePort,
        starterPointsCoordinator: StarterPointsCoordinator | undefined,
        unitOfWork: UnitOfWorkPort,
        notificationPublisher: NotificationPublisherPort | undefined,
        rateLimiter: ParticipationRateLimiter,
        env: EnvService,
        formsService: FormsService,
      ) =>
        new ParticipationService(
          formRepository,
          demographicRepository,
          participationRepository,
          rewardSettlementCoordinator,
          completionCodePort,
          starterPointsCoordinator,
          unitOfWork,
          notificationPublisher,
          rateLimiter,
          new Logger(ParticipationService.name),
          {
            // Epic 5 review P22: the same key Storage verifies with.
            storageCapabilitySecret: env.storageCapabilitySecret,
            // Plan 2.3: Research's QUOTA close, inside the completion's
            // transaction (AD-16 coordinator stays in Forms).
            quotaCloser: formsService,
          },
        ),
      inject: [
        FORM_REPOSITORY_PORT,
        DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
        PARTICIPATION_REPOSITORY_PORT,
        RewardSettlementCoordinator,
        COMPLETION_CODE_PORT,
        { token: StarterPointsCoordinator, optional: true },
        UNIT_OF_WORK_PORT,
        { token: NOTIFICATION_PUBLISHER_PORT, optional: true },
        ParticipationRateLimiter,
        EnvService,
        FormsService,
      ],
    },
    // Story IR.2b: the `reservation-expiry` scheduler job.
    ParticipationSchedulerRegistrar,
    {
      // Story 9.2 (FR-43): post-completion feedback (Participation-owned).
      provide: SURVEY_FEEDBACK_REPOSITORY_PORT,
      useClass: PrismaSurveyFeedbackRepository,
    },
    {
      provide: SurveyFeedbackService,
      useFactory: (
        feedbackRepository: SurveyFeedbackRepositoryPort,
        participationRepository: ParticipationRepositoryPort,
        formRepository: FormRepositoryPort,
        rewardSettlementCoordinator: RewardSettlementCoordinator,
      ) =>
        new SurveyFeedbackService({
          feedbackRepository,
          participationRepository,
          formRepository,
          // Epic 9 review P3: reversed External credits are not rateable.
          externalCredits: rewardSettlementCoordinator,
        }),
      inject: [
        SURVEY_FEEDBACK_REPOSITORY_PORT,
        PARTICIPATION_REPOSITORY_PORT,
        FORM_REPOSITORY_PORT,
        RewardSettlementCoordinator,
      ],
    },
    {
      // Story IR.2a: the Respondent reads of the survey runner + cancel.
      provide: SurveyRunnerReadService,
      useFactory: (
        formRepository: FormRepositoryPort,
        participationRepository: ParticipationRepositoryPort,
        rewardSettlementCoordinator: RewardSettlementCoordinator,
        starterPointsCoordinator: StarterPointsCoordinator | undefined,
        rateLimiter: ParticipationRateLimiter,
      ) =>
        new SurveyRunnerReadService({
          formRepository,
          participationRepository,
          // AD-16: Economy's read-only queries behind the Participation port.
          rewards: economyAttemptRewardQueries(
            rewardSettlementCoordinator,
            starterPointsCoordinator,
          ),
          rateLimiter,
          logger: new Logger(SurveyRunnerReadService.name),
        }),
      inject: [
        FORM_REPOSITORY_PORT,
        PARTICIPATION_REPOSITORY_PORT,
        RewardSettlementCoordinator,
        { token: StarterPointsCoordinator, optional: true },
        ParticipationRateLimiter,
      ],
    },
    {
      // Story IR.4a (AD-16): Participation-owned Publisher response reads.
      provide: PUBLISHER_RESPONSE_READ_PORT,
      useClass: PrismaPublisherResponseReadRepository,
    },
    {
      provide: PublisherResultsService,
      useFactory: (
        formRepository: FormRepositoryPort,
        responses: PublisherResponseReadPort,
      ) => new PublisherResultsService(formRepository, responses),
      inject: [FORM_REPOSITORY_PORT, PUBLISHER_RESPONSE_READ_PORT],
    },
    {
      provide: INTEGRITY_CONSENT_REPOSITORY_PORT,
      useClass: PrismaIntegrityConsentRepository,
    },
    {
      provide: IntegrityConsentService,
      useFactory: (repository: IntegrityConsentRepositoryPort) =>
        new IntegrityConsentService({ repository }),
      inject: [INTEGRITY_CONSENT_REPOSITORY_PORT],
    },
  ],
  exports: [
    FRAUD_LOG_READ_PORT,
    MISSING_CODE_REPORT_STATS_PORT,
    ParticipationService,
    PARTICIPATION_REPOSITORY_PORT,
    SurveyFeedbackService,
    SURVEY_FEEDBACK_REPOSITORY_PORT,
  ],
})
export class ParticipationModule {}
