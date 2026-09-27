import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import {
  UNIT_OF_WORK_PORT,
  UnitOfWorkPort,
} from '../../common/database/unit-of-work.port';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { FormsModule } from '../forms/forms.module';
import { FormModerationCommands } from '../forms/application/form-moderation.commands';
import {
  ADMIN_CAPABILITY_PORT,
  AdminCapabilityPort,
} from '../economy/application/ports/admin-capability.port';
import {
  NOTIFICATION_PUBLISHER_PORT,
  NotificationPublisherPort,
} from '../notifications/application/ports/notification-publisher.port';
import {
  USER_REPOSITORY_PORT,
  UserRepositoryPort,
} from '../users/application/ports/user.repository.port';
import {
  SURVEY_MODERATION_REPOSITORY_PORT,
  SurveyModerationRepositoryPort,
} from './application/ports/survey-moderation-repository.port';
import {
  PUBLISHER_DIRECTORY_PORT,
  PublisherDirectoryPort,
} from './application/ports/publisher-directory.port';
import { SurveyModerationService } from './application/survey-moderation.service';
import { PrismaSurveyModerationRepository } from './infrastructure/prisma-survey-moderation.repository';
import { UserPublisherDirectory } from './infrastructure/user-publisher-directory';
import { AdminModerationController } from './presentation/admin-moderation.controller';

/**
 * Moderation bounded context (Story 8.1): survey moderation decisions and
 * their admin-action audit. Research owns the Form transition
 * (`FormModerationCommands`), Economy owns the refund and the live Admin
 * capability check (`ADMIN_CAPABILITY_PORT`, global `EconomyModule`).
 */
@Module({
  imports: [PrismaModule, AuthModule, UsersModule, FormsModule],
  controllers: [AdminModerationController],
  providers: [
    {
      provide: SURVEY_MODERATION_REPOSITORY_PORT,
      useClass: PrismaSurveyModerationRepository,
    },
    {
      provide: PUBLISHER_DIRECTORY_PORT,
      useFactory: (users: UserRepositoryPort) =>
        new UserPublisherDirectory(users),
      inject: [USER_REPOSITORY_PORT],
    },
    {
      provide: SurveyModerationService,
      useFactory: (
        forms: FormModerationCommands,
        repository: SurveyModerationRepositoryPort,
        adminCapability: AdminCapabilityPort,
        publisherDirectory: PublisherDirectoryPort,
        unitOfWork: UnitOfWorkPort,
        notificationPublisher?: NotificationPublisherPort,
      ) =>
        new SurveyModerationService({
          forms,
          repository,
          adminCapability,
          publisherDirectory,
          unitOfWork,
          notificationPublisher,
        }),
      inject: [
        FormModerationCommands,
        SURVEY_MODERATION_REPOSITORY_PORT,
        ADMIN_CAPABILITY_PORT,
        PUBLISHER_DIRECTORY_PORT,
        UNIT_OF_WORK_PORT,
        { token: NOTIFICATION_PUBLISHER_PORT, optional: true },
      ],
    },
  ],
  exports: [SurveyModerationService, SURVEY_MODERATION_REPOSITORY_PORT],
})
export class ModerationModule {}
