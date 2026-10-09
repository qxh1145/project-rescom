import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../common/database/prisma.module';
import { AdminUsersController } from './presentation/admin-users.controller';
import { AdminAuditLogsController } from './presentation/admin-audit-logs.controller';
import { UserAdminService } from '../users/application/user-admin.service';
import { AuditLogService } from './application/audit-log.service';
import {
  USER_REPOSITORY_PORT,
  UserRepositoryPort,
} from '../users/application/ports/user.repository.port';
import {
  USER_ADMIN_TRANSACTION_PORT,
  UserAdminTransactionPort,
} from '../users/application/ports/user-admin-transaction.port';
import {
  IDENTITY_AUDIT_PORT,
  IdentityAuditPort,
} from '../auth/application/ports/identity-audit.port';
import { isIdentityLockReasonReader } from '../auth/application/ports/identity-lock-reason-reader.port';
import {
  NOTIFICATION_PUBLISHER_PORT,
  NotificationPublisherPort,
} from '../notifications/application/ports/notification-publisher.port';
import {
  AUDIT_LOG_REPOSITORY_PORT,
  AuditLogRepositoryPort,
} from './application/ports/audit-log-repository.port';
import { PrismaAuditLogRepository } from './infrastructure/prisma-audit-log.repository';
import { FormsModule } from '../forms/forms.module';
import { ParticipationModule } from '../participation/participation.module';
import { AdminOverviewController } from './presentation/admin-overview.controller';
import { AdminFraudLogController } from './presentation/admin-fraud-log.controller';
import { AdminLedgerController } from './presentation/admin-ledger.controller';
import { AdminMissingCodeReportsController } from './presentation/admin-missing-code-reports.controller';
import { AdminMissingCodeReportsService } from './application/admin-missing-code-reports.service';
import { AdminOverviewService } from './application/admin-overview.service';
import { AdminPublishedSurveysController } from './presentation/admin-published-surveys.controller';
import { AdminPublishedSurveysService } from './application/admin-published-surveys.service';
import {
  PUBLISHED_FORM_ADMIN_PORT,
  PublishedFormAdminPort,
} from '../forms/application/ports/published-form-admin.port';
import { AdminFraudLogService } from './application/admin-fraud-log.service';
import { AdminLedgerService } from './application/admin-ledger.service';
import {
  MODERATION_QUEUE_STATS_PORT,
  ModerationQueueStatsPort,
} from '../forms/application/ports/moderation-queue-stats.port';
import {
  FORM_TITLE_LOOKUP_PORT,
  FormTitleLookupPort,
} from '../forms/application/ports/form-title-lookup.port';
import {
  ADMIN_ECONOMY_STATS_PORT,
  AdminEconomyStatsPort,
} from '../economy/application/ports/admin-economy-stats.port';
import {
  FRAUD_LOG_READ_PORT,
  FraudLogReadPort,
} from '../participation/application/ports/fraud-log-read.port';
import {
  MISSING_CODE_REPORT_STATS_PORT,
  MissingCodeReportStatsPort,
} from '../participation/application/ports/missing-code-report-stats.port';
import { CLOCK, Clock } from '../../common/time/clock';
import {
  ADMIN_USER_DIRECTORY_PORT,
  AdminUserDirectoryPort,
} from '../users/application/ports/admin-user-directory.port';
import {
  USER_PROFILE_REPOSITORY_PORT,
  UserProfileRepositoryPort,
} from '../users/application/ports/user-profile.repository.port';

@Module({
  // Admin read views compose ports owned by Forms, Economy (global),
  // Participation and Identity (IR.4b part C, mock-off plan 4.1-4.3, AD-16).
  imports: [
    UsersModule,
    AuthModule,
    PrismaModule,
    FormsModule,
    ParticipationModule,
  ],
  controllers: [
    AdminUsersController,
    AdminAuditLogsController,
    AdminOverviewController,
    AdminFraudLogController,
    AdminLedgerController,
    AdminMissingCodeReportsController,
    AdminPublishedSurveysController,
  ],
  providers: [
    {
      provide: AdminOverviewService,
      useFactory: (
        queueStats: ModerationQueueStatsPort,
        economyStats: AdminEconomyStatsPort,
        fraudLogs: FraudLogReadPort,
        missingCodeReports: MissingCodeReportStatsPort,
        directory: AdminUserDirectoryPort,
        clock?: Clock,
      ) =>
        new AdminOverviewService({
          queueStats,
          economyStats,
          fraudLogs,
          missingCodeReports,
          directory,
          clock,
        }),
      inject: [
        MODERATION_QUEUE_STATS_PORT,
        ADMIN_ECONOMY_STATS_PORT,
        FRAUD_LOG_READ_PORT,
        MISSING_CODE_REPORT_STATS_PORT,
        ADMIN_USER_DIRECTORY_PORT,
        { token: CLOCK, optional: true },
      ],
    },
    {
      provide: AdminFraudLogService,
      useFactory: (
        fraudLogs: FraudLogReadPort,
        formTitles: FormTitleLookupPort,
        directory: AdminUserDirectoryPort,
        clock?: Clock,
      ) =>
        new AdminFraudLogService({ fraudLogs, formTitles, directory, clock }),
      inject: [
        FRAUD_LOG_READ_PORT,
        FORM_TITLE_LOOKUP_PORT,
        ADMIN_USER_DIRECTORY_PORT,
        { token: CLOCK, optional: true },
      ],
    },
    {
      provide: AdminMissingCodeReportsService,
      useFactory: (
        reports: MissingCodeReportStatsPort,
        formTitles: FormTitleLookupPort,
        profiles: UserProfileRepositoryPort,
      ) =>
        new AdminMissingCodeReportsService({ reports, formTitles, profiles }),
      inject: [
        MISSING_CODE_REPORT_STATS_PORT,
        FORM_TITLE_LOOKUP_PORT,
        USER_PROFILE_REPOSITORY_PORT,
      ],
    },
    {
      provide: AdminPublishedSurveysService,
      useFactory: (
        forms: PublishedFormAdminPort,
        directory: AdminUserDirectoryPort,
        audit: AuditLogRepositoryPort,
      ) => new AdminPublishedSurveysService({ forms, directory, audit }),
      inject: [
        PUBLISHED_FORM_ADMIN_PORT,
        ADMIN_USER_DIRECTORY_PORT,
        AUDIT_LOG_REPOSITORY_PORT,
      ],
    },
    {
      provide: AdminLedgerService,
      useFactory: (
        economyStats: AdminEconomyStatsPort,
        formTitles: FormTitleLookupPort,
        profiles: UserProfileRepositoryPort,
        clock?: Clock,
      ) =>
        new AdminLedgerService({ economyStats, formTitles, profiles, clock }),
      inject: [
        ADMIN_ECONOMY_STATS_PORT,
        FORM_TITLE_LOOKUP_PORT,
        USER_PROFILE_REPOSITORY_PORT,
        { token: CLOCK, optional: true },
      ],
    },
    {
      provide: UserAdminService,
      useFactory: (
        userRepository: UserRepositoryPort,
        transactionPort: UserAdminTransactionPort,
        identityAudit: IdentityAuditPort,
        notificationPublisher?: NotificationPublisherPort,
      ) =>
        new UserAdminService(
          userRepository,
          transactionPort,
          identityAudit,
          isIdentityLockReasonReader(identityAudit) ? identityAudit : undefined,
          // Story IR.4b B3: ACCOUNT_LOCKED / ACCOUNT_UNLOCKED (in-app + email).
          notificationPublisher,
        ),
      inject: [
        USER_REPOSITORY_PORT,
        USER_ADMIN_TRANSACTION_PORT,
        IDENTITY_AUDIT_PORT,
        { token: NOTIFICATION_PUBLISHER_PORT, optional: true },
      ],
    },
    {
      provide: AUDIT_LOG_REPOSITORY_PORT,
      useClass: PrismaAuditLogRepository,
    },
    {
      provide: AuditLogService,
      useFactory: (auditLogRepository: AuditLogRepositoryPort) =>
        new AuditLogService(auditLogRepository),
      inject: [AUDIT_LOG_REPOSITORY_PORT],
    },
  ],
  exports: [UserAdminService, AuditLogService, AUDIT_LOG_REPOSITORY_PORT],
})
export class AdminModule {}
