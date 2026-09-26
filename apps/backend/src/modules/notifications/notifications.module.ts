import { Global, Logger, Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsService } from './application/notifications.service';
import {
  NOTIFICATION_REPOSITORY_PORT,
  NotificationRepositoryPort,
} from './application/ports/notification-repository.port';
import { NOTIFICATION_PUBLISHER_PORT } from './application/ports/notification-publisher.port';
import { PrismaNotificationRepository } from './infrastructure/prisma-notification.repository';
import { NotificationsController } from './presentation/notifications.controller';

/**
 * Notifications bounded context (Story 9.6). Global so producers in other
 * contexts can inject `NOTIFICATION_PUBLISHER_PORT` (optionally) without
 * importing this module. The publisher port is its only export.
 */
@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: NOTIFICATION_REPOSITORY_PORT,
      useClass: PrismaNotificationRepository,
    },
    {
      provide: NotificationsService,
      useFactory: (repository: NotificationRepositoryPort) =>
        new NotificationsService(
          repository,
          new Logger(NotificationsService.name),
        ),
      inject: [NOTIFICATION_REPOSITORY_PORT],
    },
    {
      provide: NOTIFICATION_PUBLISHER_PORT,
      useExisting: NotificationsService,
    },
  ],
  // Only the publisher port leaves this context (AC3.2 / AD-16, Epic 9 review
  // P11): the repository and the read-side service stay private so no other
  // module can read or mark another user's notifications.
  exports: [NOTIFICATION_PUBLISHER_PORT],
})
export class NotificationsModule {}
