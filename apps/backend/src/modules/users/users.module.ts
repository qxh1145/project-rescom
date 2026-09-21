import { Module } from '@nestjs/common';
import { USER_REPOSITORY_PORT } from './application/ports/user.repository.port';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { USER_ADMIN_TRANSACTION_PORT } from './application/ports/user-admin-transaction.port';
import { PrismaUserAdminTransactionAdapter } from './infrastructure/prisma-user-admin-transaction.adapter';
import {
  DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
  DemographicProfileRepositoryPort,
} from './application/ports/demographic-profile.repository.port';
import { PrismaDemographicProfileRepository } from './infrastructure/prisma-demographic-profile.repository';
import { DemographicsService } from './application/demographics.service';
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
    {
      provide: DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
      useClass: PrismaDemographicProfileRepository,
    },
    {
      provide: DemographicsService,
      useFactory: (repository: DemographicProfileRepositoryPort) =>
        new DemographicsService(repository),
      inject: [DEMOGRAPHIC_PROFILE_REPOSITORY_PORT],
    },
  ],
  exports: [
    USER_REPOSITORY_PORT,
    USER_ADMIN_TRANSACTION_PORT,
    DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
    DemographicsService,
  ],
})
export class UsersModule {}
