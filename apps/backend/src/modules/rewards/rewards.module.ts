import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import {
  UNIT_OF_WORK_PORT,
  UnitOfWorkPort,
} from '../../common/database/unit-of-work.port';
import { CLOCK, Clock } from '../../common/time/clock';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { ParticipationModule } from '../participation/participation.module';
import { UsersModule } from '../users/users.module';
import {
  ADMIN_CAPABILITY_PORT,
  AdminCapabilityPort,
} from '../economy/application/ports/admin-capability.port';
import {
  WALLET_BALANCE_PORT,
  WalletBalancePort,
} from './application/ports/wallet-balance.port';
import {
  VOUCHER_REPOSITORY_PORT,
  VoucherRepositoryPort,
} from './application/ports/voucher-repository.port';
import {
  VOUCHER_CODE_REPOSITORY_PORT,
  VoucherCodeRepositoryPort,
} from './application/ports/voucher-code-repository.port';
import {
  FLASH_SALE_READ_PORT,
  FlashSaleReadPort,
} from './application/ports/flash-sale-read.port';
import {
  FLASH_SALE_REPOSITORY_PORT,
  FlashSaleRepositoryPort,
} from './application/ports/flash-sale-repository.port';
import {
  ADMIN_USER_DIRECTORY_PORT,
  AdminUserDirectoryPort,
} from '../users/application/ports/admin-user-directory.port';
import { PrismaVoucherRepository } from './infrastructure/prisma-voucher.repository';
import { PrismaVoucherCodeRepository } from './infrastructure/prisma-voucher-code.repository';
import { PrismaFlashSaleRepository } from './infrastructure/prisma-flash-sale.repository';
import { RewardsSchedulerRegistrar } from './infrastructure/rewards-scheduler.registrar';
import { FlashSaleLifecycleService } from './application/flash-sale-lifecycle.service';
import { RewardsAdminFlashService } from './application/rewards-admin-flash.service';
import { RewardsAdminCatalogService } from './application/rewards-admin-catalog.service';
import { RewardsCatalogService } from './application/rewards-catalog.service';
import { AdminRewardsVouchersController } from './presentation/admin-rewards-vouchers.controller';
import { AdminRewardsFlashSalesController } from './presentation/admin-rewards-flash-sales.controller';
import { RewardsCatalogController } from './presentation/rewards-catalog.controller';

import {
  REDEMPTION_REPOSITORY_PORT,
  RedemptionRepositoryPort,
} from './application/ports/redemption-repository.port';
import {
  ACCOUNT_FUNDING_PORT,
  ACCOUNT_STANDING_PORT,
  ACCOUNT_STATUS_PORT,
  AccountFundingPort,
  AccountStandingPort,
  AccountStatusPort,
  FRAUD_FLAG_READ_PORT,
  FraudFlagReadPort,
  SURVEY_COMPLETION_PORT,
  SurveyCompletionPort,
} from './application/ports/account-standing.port';
import {
  FraudFlagPort,
  FRAUD_FLAG_PORT,
} from './application/ports/fraud-flag.port';
import {
  SPEND_POINTS_PORT,
  SpendPointsPort,
} from './application/ports/spend-points.port';
import { PrismaRedemptionRepository } from './infrastructure/prisma-redemption.repository';
import { RewardsQuoteService } from './application/rewards-quote.service';
import { RewardsRedemptionService } from './application/rewards-redemption.service';
import { RewardsRedemptionController } from './presentation/rewards-redemption.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    EconomyModule,
    UsersModule,
    ParticipationModule,
  ],
  controllers: [
    AdminRewardsVouchersController,
    AdminRewardsFlashSalesController,
    RewardsCatalogController,
    RewardsRedemptionController,
  ],
  providers: [
    { provide: VOUCHER_REPOSITORY_PORT, useClass: PrismaVoucherRepository },
    {
      provide: VOUCHER_CODE_REPOSITORY_PORT,
      useClass: PrismaVoucherCodeRepository,
    },
    {
      provide: FLASH_SALE_REPOSITORY_PORT,
      useClass: PrismaFlashSaleRepository,
    },
    {
      provide: FLASH_SALE_READ_PORT,
      useExisting: FLASH_SALE_REPOSITORY_PORT,
    },
    {
      provide: REDEMPTION_REPOSITORY_PORT,
      useClass: PrismaRedemptionRepository,
    },
    {
      // The facts are owned by Users, Participation and Economy; Rewards only
      // sees them through its own port.
      provide: ACCOUNT_STANDING_PORT,
      useFactory: (
        status: AccountStatusPort,
        surveys: SurveyCompletionPort,
        fraudFlags: FraudFlagReadPort,
        funding: AccountFundingPort,
      ): AccountStandingPort => ({
        isActive: (userId) => status.isActive(userId),
        completedSurveyInLastDays: (userId, days, now) =>
          surveys.completedSurveyInLastDays(userId, days, now),
        hasBlockingFraudFlag: (userId, since) =>
          fraudFlags.hasBlockingFraudFlag(userId, since),
        isActivated: (userId) => funding.isActivated(userId),
        hasApprovedTopUpSince: (userId, since) =>
          funding.hasApprovedTopUpSince(userId, since),
      }),
      inject: [
        ACCOUNT_STATUS_PORT,
        SURVEY_COMPLETION_PORT,
        FRAUD_FLAG_READ_PORT,
        ACCOUNT_FUNDING_PORT,
      ],
    },
    {
      provide: RewardsAdminCatalogService,
      useFactory: (
        vouchers: VoucherRepositoryPort,
        codes: VoucherCodeRepositoryPort,
        flashSales: FlashSaleReadPort,
        adminCapability: AdminCapabilityPort,
        redemptions: RedemptionRepositoryPort,
        unitOfWork: UnitOfWorkPort,
        clock: Clock,
      ) =>
        new RewardsAdminCatalogService({
          vouchers,
          codes,
          flashSales,
          adminCapability,
          redemptions,
          unitOfWork,
          now: () => clock.now(),
        }),
      inject: [
        VOUCHER_REPOSITORY_PORT,
        VOUCHER_CODE_REPOSITORY_PORT,
        FLASH_SALE_READ_PORT,
        ADMIN_CAPABILITY_PORT,
        REDEMPTION_REPOSITORY_PORT,
        UNIT_OF_WORK_PORT,
        CLOCK,
      ],
    },
    {
      provide: RewardsCatalogService,
      useFactory: (
        vouchers: VoucherRepositoryPort,
        flashSales: FlashSaleReadPort,
        wallet: WalletBalancePort,
        clock: Clock,
      ) =>
        new RewardsCatalogService({
          vouchers,
          flashSales,
          wallet,
          now: () => clock.now(),
        }),
      inject: [
        VOUCHER_REPOSITORY_PORT,
        FLASH_SALE_READ_PORT,
        WALLET_BALANCE_PORT,
        CLOCK,
      ],
    },
    {
      provide: RewardsQuoteService,
      useFactory: (
        vouchers: VoucherRepositoryPort,
        flashSales: FlashSaleReadPort,
        redemptions: RedemptionRepositoryPort,
        wallet: WalletBalancePort,
        accountStanding: AccountStandingPort,
        clock: Clock,
      ) =>
        new RewardsQuoteService({
          vouchers,
          flashSales,
          redemptions,
          wallet,
          accountStanding,
          now: () => clock.now(),
        }),
      inject: [
        VOUCHER_REPOSITORY_PORT,
        FLASH_SALE_READ_PORT,
        REDEMPTION_REPOSITORY_PORT,
        WALLET_BALANCE_PORT,
        ACCOUNT_STANDING_PORT,
        CLOCK,
      ],
    },
    {
      provide: RewardsRedemptionService,
      useFactory: (
        vouchers: VoucherRepositoryPort,
        flashSales: FlashSaleReadPort,
        redemptions: RedemptionRepositoryPort,
        wallet: WalletBalancePort,
        accountStanding: AccountStandingPort,
        spendPoints: SpendPointsPort,
        fraudFlag: FraudFlagPort,
        unitOfWork: UnitOfWorkPort,
        clock: Clock,
      ) =>
        new RewardsRedemptionService({
          vouchers,
          flashSales,
          redemptions,
          wallet,
          accountStanding,
          spendPoints,
          fraudFlag,
          unitOfWork,
          now: () => clock.now(),
        }),
      inject: [
        VOUCHER_REPOSITORY_PORT,
        FLASH_SALE_READ_PORT,
        REDEMPTION_REPOSITORY_PORT,
        WALLET_BALANCE_PORT,
        ACCOUNT_STANDING_PORT,
        SPEND_POINTS_PORT,
        FRAUD_FLAG_PORT,
        UNIT_OF_WORK_PORT,
        CLOCK,
      ],
    },
    {
      provide: FlashSaleLifecycleService,
      useFactory: (
        flashSales: FlashSaleRepositoryPort,
        vouchers: VoucherRepositoryPort,
        unitOfWork: UnitOfWorkPort,
      ) =>
        new FlashSaleLifecycleService({
          flashSales,
          vouchers,
          unitOfWork,
        }),
      inject: [
        FLASH_SALE_REPOSITORY_PORT,
        VOUCHER_REPOSITORY_PORT,
        UNIT_OF_WORK_PORT,
      ],
    },
    {
      provide: RewardsAdminFlashService,
      useFactory: (
        flashRepo: FlashSaleRepositoryPort,
        voucherRepo: VoucherRepositoryPort,
        userDirectory: AdminUserDirectoryPort,
        adminCapability: AdminCapabilityPort,
        unitOfWork: UnitOfWorkPort,
        clock: Clock,
      ) =>
        new RewardsAdminFlashService({
          flashRepo,
          voucherRepo,
          userDirectory,
          adminCapability,
          unitOfWork,
          now: () => clock.now(),
        }),
      inject: [
        FLASH_SALE_REPOSITORY_PORT,
        VOUCHER_REPOSITORY_PORT,
        ADMIN_USER_DIRECTORY_PORT,
        ADMIN_CAPABILITY_PORT,
        UNIT_OF_WORK_PORT,
        CLOCK,
      ],
    },
    RewardsSchedulerRegistrar,
  ],
})
export class RewardsModule {}
