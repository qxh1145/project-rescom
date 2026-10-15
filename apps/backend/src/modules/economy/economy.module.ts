import { Global, Logger, Module } from '@nestjs/common';
import { WALLET_BALANCE_PORT } from '../rewards/application/ports/wallet-balance.port';
import {
  SPEND_POINTS_PORT,
  SpendPointsPort,
} from '../rewards/application/ports/spend-points.port';
import {
  REVERSE_SPEND_PORT,
  ReverseSpendPort,
} from '../rewards/application/ports/reverse-spend.port';
import { ACCOUNT_FUNDING_PORT } from '../rewards/application/ports/account-standing.port';
import { PrismaAccountFundingReader } from './infrastructure/prisma-account-funding.reader';
import { PrismaWalletBalanceReader } from './infrastructure/prisma-wallet-balance.reader';
import { PrismaModule } from '../../common/database/prisma.module';
import { PayosAvailability } from './application/payos-availability';
import { PayosTopUpService } from './application/payos-top-up.service';
import { TopUpNotificationHandler } from './application/top-up-notification.handler';
import {
  PAYOS_TOP_UP_REPOSITORY_PORT,
  PayosTopUpRepositoryPort,
} from './application/ports/payos-top-up-repository.port';
import { PaymentProviderPort } from './application/ports/payment-provider.port';
import { PrismaPayosTopUpRepository } from './infrastructure/prisma-payos-top-up.repository';
import { PayosEnableGuard } from './infrastructure/payos-enable-guard';
import { PayosTopUpController } from './presentation/payos-top-up.controller';
import { PayosWebhookController } from './presentation/payos-webhook.controller';
import {
  PayosCheckoutEnabledGuard,
  ManualCheckoutEnabledGuard,
} from './presentation/payos-checkout-enabled.guard';
import { CLOCK, Clock } from '../../common/time/clock';
import { EconomySchedulerRegistrar } from './infrastructure/economy-scheduler.registrar';
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
import { PAYMENT_PROVIDER_PORT } from './application/ports/payment-provider.port';
import { createPaymentProvider } from './infrastructure/payos-payment-provider.adapter';
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
import { ADMIN_ECONOMY_STATS_PORT } from './application/ports/admin-economy-stats.port';
import { PrismaAdminEconomyStats } from './infrastructure/prisma-admin-economy-stats';
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
    PayosTopUpController,
    PayosWebhookController,
    AdminTopUpController,
  ],
  providers: [
    { provide: WALLET_BALANCE_PORT, useClass: PrismaWalletBalanceReader },
    { provide: ACCOUNT_FUNDING_PORT, useClass: PrismaAccountFundingReader },
    {
      provide: SPEND_POINTS_PORT,
      useFactory: (ledger: LedgerService): SpendPointsPort => ({
        spendPoints: async (params, options) => {
          const journal = await ledger.spendPoints(params, options);
          return {
            journalId: journal.id,
            idempotencyKey: journal.idempotencyKey,
          };
        },
      }),
      inject: [LedgerService],
    },
    {
      provide: REVERSE_SPEND_PORT,
      useFactory: (ledger: LedgerService): ReverseSpendPort => ({
        reverseSpend: async (params) => {
          const journal = await ledger.reverseJournal({
            targetJournalId: params.journalId,
            idempotencyKey: params.idempotencyKey,
            reason: params.reason,
          });
          return { journalId: journal.id };
        },
      }),
      inject: [LedgerService],
    },
    // Admin read views (IR.4b part C, mock-off plan 4.1 and 4.3).
    {
      provide: ADMIN_ECONOMY_STATS_PORT,
      useClass: PrismaAdminEconomyStats,
    },
    {
      provide: LEDGER_REPOSITORY_PORT,
      useClass: PrismaLedgerRepository,
    },
    {
      provide: LedgerService,
      // Story IR.2b Task 2.1: the scheduler clock drives journal timestamps
      // and the 48h maturity cutoff, so clock-controlled tests can cross it.
      useFactory: (repo: LedgerRepositoryPort, clock?: Clock) =>
        new LedgerService(repo, {
          logger: new Logger(LedgerService.name),
          ...(clock ? { clock: () => clock.now() } : {}),
        }),
      inject: [LEDGER_REPOSITORY_PORT, { token: CLOCK, optional: true }],
    },
    // Story IR.2b: pending-release + starter-expiry jobs and the
    // InternalRewardRequested Outbox handler.
    EconomySchedulerRegistrar,
    { provide: PayosAvailability, useValue: new PayosAvailability() },
    PayosEnableGuard,
    PayosCheckoutEnabledGuard,
    ManualCheckoutEnabledGuard,
    {
      provide: PAYOS_TOP_UP_REPOSITORY_PORT,
      useClass: PrismaPayosTopUpRepository,
    },
    {
      provide: PayosTopUpService,
      useFactory: (
        repository: PayosTopUpRepositoryPort,
        provider: PaymentProviderPort,
        env: EnvService,
        unitOfWork: UnitOfWorkPort,
        ledgerService: LedgerService,
      ) =>
        new PayosTopUpService({
          unitOfWork,
          ledgerService,
          repository,
          provider,
          appBaseUrl: env.emailAppBaseUrl,
          limit: env.payosCheckoutLimit,
          windowSeconds: env.payosCheckoutWindowSeconds,
          logger: new Logger(PayosTopUpService.name),
        }),
      inject: [
        PAYOS_TOP_UP_REPOSITORY_PORT,
        PAYMENT_PROVIDER_PORT,
        EnvService,
        UNIT_OF_WORK_PORT,
        LedgerService,
      ],
    },
    {
      provide: TopUpNotificationHandler,
      useFactory: (publisher: NotificationPublisherPort) =>
        new TopUpNotificationHandler(publisher),
      inject: [NOTIFICATION_PUBLISHER_PORT],
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
      provide: PAYMENT_PROVIDER_PORT,
      useFactory: (env: EnvService) => createPaymentProvider(env),
      inject: [EnvService],
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
    WALLET_BALANCE_PORT,
    ACCOUNT_FUNDING_PORT,
    SPEND_POINTS_PORT,
    REVERSE_SPEND_PORT,
    ADMIN_ECONOMY_STATS_PORT,
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
