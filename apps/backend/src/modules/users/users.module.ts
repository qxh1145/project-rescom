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
import { StarterPointsCoordinator } from '../economy/application/starter-points.coordinator';
import {
  USER_PROFILE_REPOSITORY_PORT,
  UserProfileRepositoryPort,
} from './application/ports/user-profile.repository.port';
import { PrismaUserProfileRepository } from './infrastructure/prisma-user-profile.repository';
import { UserProfileService } from './application/user-profile.service';
import { ADMIN_USER_DIRECTORY_PORT } from './application/ports/admin-user-directory.port';
import { PrismaAdminUserDirectory } from './infrastructure/prisma-admin-user-directory';
@Module({
  providers: [
    // Admin FraudLog view (mock-off plan 4.2): account status and search.
    {
      provide: ADMIN_USER_DIRECTORY_PORT,
      useClass: PrismaAdminUserDirectory,
    },
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
      useFactory: (
        repository: DemographicProfileRepositoryPort,
        starterPointsCoordinator?: StarterPointsCoordinator,
      ) => new DemographicsService(repository, starterPointsCoordinator),
      inject: [
        DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
        { token: StarterPointsCoordinator, optional: true },
      ],
    },
    {
      provide: USER_PROFILE_REPOSITORY_PORT,
      useClass: PrismaUserProfileRepository,
    },
    {
      provide: UserProfileService,
      useFactory: (repository: UserProfileRepositoryPort) =>
        new UserProfileService(repository),
      inject: [USER_PROFILE_REPOSITORY_PORT],
    },
  ],
  exports: [
    ADMIN_USER_DIRECTORY_PORT,
    USER_REPOSITORY_PORT,
    USER_ADMIN_TRANSACTION_PORT,
    DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
    DemographicsService,
    USER_PROFILE_REPOSITORY_PORT,
    UserProfileService,
  ],
})
export class UsersModule {}
