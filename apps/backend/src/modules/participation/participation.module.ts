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
  ],
  providers: [
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
          // Epic 5 review P22: the same key Storage verifies with.
          { storageCapabilitySecret: env.storageCapabilitySecret },
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
      ],
    },
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
  ],
  exports: [
    ParticipationService,
    PARTICIPATION_REPOSITORY_PORT,
    SurveyFeedbackService,
    SURVEY_FEEDBACK_REPOSITORY_PORT,
  ],
})
export class ParticipationModule {}
