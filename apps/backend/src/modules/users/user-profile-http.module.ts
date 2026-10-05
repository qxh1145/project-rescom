import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from './users.module';
import { UserProfileController } from './presentation/user-profile.controller';

/**
 * HTTP surface of the FR-9 profile (Story IR.4b part A). `AuthModule` imports
 * `UsersModule`, so a controller whose guards need `AuthModule` cannot be
 * registered in `UsersModule` without a cycle — the reason
 * `DemographicsController` is registered by `MarketplaceModule`.
 */
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [UserProfileController],
})
export class UserProfileHttpModule {}
