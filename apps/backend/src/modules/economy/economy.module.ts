import { Global, Logger, Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import { AuthModule } from '../auth/auth.module';
import {
  LEDGER_REPOSITORY_PORT,
  LedgerRepositoryPort,
} from './application/ports/ledger-repository.port';
import { PrismaLedgerRepository } from './infrastructure/prisma-ledger.repository';
import { LedgerService } from './application/ledger.service';
import { RewardSettlementCoordinator } from './application/reward-settlement.coordinator';
import {
  StarterPointsCoordinator,
  StarterPointsUserDataProvider,
} from './application/starter-points.coordinator';
import { PrismaStarterPointsDataProvider } from './infrastructure/prisma-starter-points-data-provider';
import { LedgerController } from './presentation/ledger.controller';
import { StarterPointsController } from './presentation/starter-points.controller';
import {
  NOTIFICATION_PUBLISHER_PORT,
  NotificationPublisherPort,
} from '../notifications/application/ports/notification-publisher.port';
import {
  UNIT_OF_WORK_PORT,
  UnitOfWorkPort,
} from '../../common/database/unit-of-work.port';
import { EnvService } from '../../common/config/env.service';
import {
  TOP_UP_REPOSITORY_PORT,
  TopUpRepositoryPort,
} from './application/ports/top-up-repository.port';
import {
  ADMIN_CAPABILITY_PORT,
  AdminCapabilityPort,
} from './application/ports/admin-capability.port';
import { TopUpService } from './application/top-up.service';
import { PrismaTopUpRepository } from './infrastructure/prisma-top-up.repository';
import { PrismaAdminCapabilityRepository } from './infrastructure/prisma-admin-capability.repository';
import { TopUpController } from './presentation/top-up.controller';
import { AdminTopUpController } from './presentation/admin-top-up.controller';
import {
  EXTERNAL_DISPUTE_HOLD_QUERY_PORT,
  ExternalDisputeHoldQueryPort,
  NoExternalDisputeHolds,
} from './application/ports/external-dispute-hold-query.port';

export const STARTER_POINTS_DATA_PROVIDER = Symbol(
  'STARTER_POINTS_DATA_PROVIDER',
);

@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    LedgerController,
    StarterPointsController,
    TopUpController,
    AdminTopUpController,
  ],
  providers: [
    {
      provide: LEDGER_REPOSITORY_PORT,
      useClass: PrismaLedgerRepository,
    },
    {
      provide: LedgerService,
      useFactory: (repo: LedgerRepositoryPort) =>
        new LedgerService(repo, { logger: new Logger(LedgerService.name) }),
      inject: [LEDGER_REPOSITORY_PORT],
    },
    {
      // Epic 6 review P2: server-side dispute check for Pending releases.
      // Phase 1 has no dispute cases; Story 8.5 must bind a real query.
      provide: EXTERNAL_DISPUTE_HOLD_QUERY_PORT,
      useValue: new NoExternalDisputeHolds(),
    },
    {
      provide: RewardSettlementCoordinator,
      useFactory: (
        ledgerService: LedgerService,
        starterPointsCoordinator: StarterPointsCoordinator,
        disputeHolds: ExternalDisputeHoldQueryPort,
        notificationPublisher?: NotificationPublisherPort,
      ) =>
        new RewardSettlementCoordinator(
          ledgerService,
          notificationPublisher,
          starterPointsCoordinator,
          disputeHolds,
        ),
      inject: [
        LedgerService,
        StarterPointsCoordinator,
        EXTERNAL_DISPUTE_HOLD_QUERY_PORT,
        { token: NOTIFICATION_PUBLISHER_PORT, optional: true },
      ],
    },
    {
      provide: STARTER_POINTS_DATA_PROVIDER,
      useClass: PrismaStarterPointsDataProvider,
    },
    {
      provide: StarterPointsCoordinator,
      useFactory: (
        ledgerService: LedgerService,
        dataProvider: StarterPointsUserDataProvider,
        notificationPublisher?: NotificationPublisherPort,
      ) =>
        new StarterPointsCoordinator(
          ledgerService,
          dataProvider,
          notificationPublisher,
          new Logger(StarterPointsCoordinator.name),
        ),
      inject: [
        LedgerService,
        STARTER_POINTS_DATA_PROVIDER,
        { token: NOTIFICATION_PUBLISHER_PORT, optional: true },
      ],
    },
    {
      provide: TOP_UP_REPOSITORY_PORT,
      useClass: PrismaTopUpRepository,
    },
    {
      provide: ADMIN_CAPABILITY_PORT,
      useClass: PrismaAdminCapabilityRepository,
    },
    {
      provide: TopUpService,
      useFactory: (
        repository: TopUpRepositoryPort,
        ledgerService: LedgerService,
        adminCapability: AdminCapabilityPort,
        env: EnvService,
        unitOfWork: UnitOfWorkPort,
        notificationPublisher?: NotificationPublisherPort,
      ) =>
        new TopUpService({
          repository,
          ledgerService,
          adminCapability,
          // Read per request so the bank account comes from the live config.
          paymentConfig: () => ({
            bankName: env.topUpBankName,
            bankBin: env.topUpBankBin,
            accountNumber: env.topUpBankAccountNumber,
            accountName: env.topUpBankAccountName,
          }),
          unitOfWork,
          notificationPublisher,
        }),
      inject: [
        TOP_UP_REPOSITORY_PORT,
        LedgerService,
        ADMIN_CAPABILITY_PORT,
        EnvService,
        UNIT_OF_WORK_PORT,
        { token: NOTIFICATION_PUBLISHER_PORT, optional: true },
      ],
    },
  ],
  exports: [
    LedgerService,
    TopUpService,
    TOP_UP_REPOSITORY_PORT,
    ADMIN_CAPABILITY_PORT,
    RewardSettlementCoordinator,
    StarterPointsCoordinator,
    LEDGER_REPOSITORY_PORT,
    STARTER_POINTS_DATA_PROVIDER,
    EXTERNAL_DISPUTE_HOLD_QUERY_PORT,
  ],
})
export class EconomyModule {}
