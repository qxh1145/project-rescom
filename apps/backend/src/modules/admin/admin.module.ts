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
import {
  AUDIT_LOG_REPOSITORY_PORT,
  AuditLogRepositoryPort,
} from './application/ports/audit-log-repository.port';
import { PrismaAuditLogRepository } from './infrastructure/prisma-audit-log.repository';

@Module({
  imports: [UsersModule, AuthModule, PrismaModule],
  controllers: [AdminUsersController, AdminAuditLogsController],
  providers: [
    {
      provide: UserAdminService,
      useFactory: (
        userRepository: UserRepositoryPort,
        transactionPort: UserAdminTransactionPort,
        identityAudit: IdentityAuditPort,
      ) => new UserAdminService(userRepository, transactionPort, identityAudit),
      inject: [
        USER_REPOSITORY_PORT,
        USER_ADMIN_TRANSACTION_PORT,
        IDENTITY_AUDIT_PORT,
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
