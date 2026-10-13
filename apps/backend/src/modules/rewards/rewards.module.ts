import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import {
  UNIT_OF_WORK_PORT,
  UnitOfWorkPort,
} from '../../common/database/unit-of-work.port';
import { CLOCK, Clock } from '../../common/time/clock';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
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
import { PrismaVoucherRepository } from './infrastructure/prisma-voucher.repository';
import { PrismaVoucherCodeRepository } from './infrastructure/prisma-voucher-code.repository';
import { PrismaFlashSaleReadRepository } from './infrastructure/prisma-flash-sale-read.repository';
import { RewardsAdminCatalogService } from './application/rewards-admin-catalog.service';
import { RewardsCatalogService } from './application/rewards-catalog.service';
import { AdminRewardsVouchersController } from './presentation/admin-rewards-vouchers.controller';
import { RewardsCatalogController } from './presentation/rewards-catalog.controller';

@Module({
  imports: [PrismaModule, AuthModule, EconomyModule],
  controllers: [AdminRewardsVouchersController, RewardsCatalogController],
  providers: [
    { provide: VOUCHER_REPOSITORY_PORT, useClass: PrismaVoucherRepository },
    {
      provide: VOUCHER_CODE_REPOSITORY_PORT,
      useClass: PrismaVoucherCodeRepository,
    },
    { provide: FLASH_SALE_READ_PORT, useClass: PrismaFlashSaleReadRepository },
    {
      provide: RewardsAdminCatalogService,
      useFactory: (
        vouchers: VoucherRepositoryPort,
        codes: VoucherCodeRepositoryPort,
        flashSales: FlashSaleReadPort,
        adminCapability: AdminCapabilityPort,
        unitOfWork: UnitOfWorkPort,
        clock: Clock,
      ) =>
        new RewardsAdminCatalogService({
          vouchers,
          codes,
          flashSales,
          adminCapability,
          unitOfWork,
          now: () => clock.now(),
        }),
      inject: [
        VOUCHER_REPOSITORY_PORT,
        VOUCHER_CODE_REPOSITORY_PORT,
        FLASH_SALE_READ_PORT,
        ADMIN_CAPABILITY_PORT,
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
  ],
})
export class RewardsModule {}
