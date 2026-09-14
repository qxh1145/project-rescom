import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { AdminUsersController } from './presentation/admin-users.controller';
import { UserAdminService } from '../users/application/user-admin.service';
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

@Module({
  imports: [UsersModule, AuthModule],
  controllers: [AdminUsersController],
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
  ],
  exports: [UserAdminService],
})
export class AdminModule {}
