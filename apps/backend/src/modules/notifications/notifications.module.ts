import { Global, Logger, Module } from '@nestjs/common';
import { EnvService } from '../../common/config/env.service';
import { PrismaModule } from '../../common/database/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import {
  USER_REPOSITORY_PORT,
  UserRepositoryPort,
} from '../users/application/ports/user.repository.port';
import { NotificationsService } from './application/notifications.service';
import { EmailDeliveryHandler } from './application/email-delivery.handler';
import {
  NOTIFICATION_REPOSITORY_PORT,
  NotificationRepositoryPort,
} from './application/ports/notification-repository.port';
import { NOTIFICATION_PUBLISHER_PORT } from './application/ports/notification-publisher.port';
import {
  EMAIL_SENDER_PORT,
  EmailSenderPort,
} from './application/ports/email-sender.port';
import {
  EMAIL_DELIVERY_REPOSITORY_PORT,
  EmailDeliveryRepositoryPort,
} from './application/ports/email-delivery.repository.port';
import { PrismaNotificationRepository } from './infrastructure/prisma-notification.repository';
import { PrismaEmailDeliveryRepository } from './infrastructure/prisma-email-delivery.repository';
import { CaptureEmailSender } from './infrastructure/capture-email-sender';
import { DisabledEmailSender } from './infrastructure/disabled-email-sender';
import { SmtpEmailSender } from './infrastructure/smtp-email-sender';
import { NotificationsSchedulerRegistrar } from './infrastructure/notifications-scheduler.registrar';
import { NotificationsController } from './presentation/notifications.controller';

/** Story IR.4b B-T3: the adapter `EMAIL_DELIVERY_MODE` selects. */
export function createEmailSender(env: EnvService): EmailSenderPort {
  switch (env.emailDeliveryMode) {
    case 'disabled':
      return new DisabledEmailSender();
    case 'smtp':
      return new SmtpEmailSender({
        ...env.smtp,
        from: env.emailFrom,
        replyTo: env.emailReplyTo,
        messageIdDomain: env.emailMessageIdDomain,
        timeoutMs: env.emailSendTimeoutMs,
      });
    case 'capture':
      return new CaptureEmailSender();
  }
}

/**
 * Notifications bounded context (Story 9.6). Global so producers in other
 * contexts can inject `NOTIFICATION_PUBLISHER_PORT` (optionally) without
 * importing this module. Story IR.4b part B adds email: critical types queue
 * a `NotificationEmailRequested` Outbox event, delivered by the
 * `notifications.email-delivery` handler through `EMAIL_SENDER_PORT`.
 * The publisher port and the sender port are its only exports.
 */
@Global()
@Module({
  imports: [PrismaModule, AuthModule, UsersModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: NOTIFICATION_REPOSITORY_PORT,
      useClass: PrismaNotificationRepository,
    },
    {
      provide: NotificationsService,
      useFactory: (repository: NotificationRepositoryPort, env: EnvService) =>
        new NotificationsService(
          repository,
          new Logger(NotificationsService.name),
          undefined,
          { emailRequests: env.emailDeliveryMode !== 'disabled' },
        ),
      inject: [NOTIFICATION_REPOSITORY_PORT, EnvService],
    },
    {
      provide: NOTIFICATION_PUBLISHER_PORT,
      useExisting: NotificationsService,
    },
    {
      provide: EMAIL_SENDER_PORT,
      useFactory: (env: EnvService) => createEmailSender(env),
      inject: [EnvService],
    },
    {
      provide: EMAIL_DELIVERY_REPOSITORY_PORT,
      useClass: PrismaEmailDeliveryRepository,
    },
    {
      provide: EmailDeliveryHandler,
      useFactory: (
        deliveries: EmailDeliveryRepositoryPort,
        sender: EmailSenderPort,
        users: UserRepositoryPort,
        env: EnvService,
      ) =>
        new EmailDeliveryHandler(
          deliveries,
          sender,
          users,
          {
            appBaseUrl: env.emailAppBaseUrl,
            supportEmail: env.emailReplyTo,
            sendTimeoutMs: env.emailSendTimeoutMs,
          },
          new Logger(EmailDeliveryHandler.name),
        ),
      inject: [
        EMAIL_DELIVERY_REPOSITORY_PORT,
        EMAIL_SENDER_PORT,
        USER_REPOSITORY_PORT,
        EnvService,
      ],
    },
    NotificationsSchedulerRegistrar,
  ],
  // Only the publisher port leaves this context (AC3.2 / AD-16, Epic 9 review
  // P11): the repository and the read-side service stay private so no other
  // module can read or mark another user's notifications. The sender port is
  // exported for Auth's password-reset email (plan 5.4).
  exports: [NOTIFICATION_PUBLISHER_PORT, EMAIL_SENDER_PORT],
})
export class NotificationsModule {}
