import { Module } from '@nestjs/common';
import { USER_REPOSITORY_PORT } from './application/ports/user.repository.port';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { USER_ADMIN_TRANSACTION_PORT } from './application/ports/user-admin-transaction.port';
import { PrismaUserAdminTransactionAdapter } from './infrastructure/prisma-user-admin-transaction.adapter';

@Module({
  providers: [
    {
      provide: USER_REPOSITORY_PORT,
      useClass: PrismaUserRepository,
    },
    {
      provide: USER_ADMIN_TRANSACTION_PORT,
      useClass: PrismaUserAdminTransactionAdapter,
    },
  ],
  exports: [USER_REPOSITORY_PORT, USER_ADMIN_TRANSACTION_PORT],
})
export class UsersModule {}
