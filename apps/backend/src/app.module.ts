import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './common/config/config.module';
import { PrismaModule } from './common/database/prisma.module';
import { SchedulerModule } from './common/scheduler/scheduler.module';
import { SystemModule } from './common/system/system.module';
import { SecurityModule } from './common/security/security.module';
import { AppThrottlerGuard } from './common/security/app-throttler.guard';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { FormsModule } from './modules/forms/forms.module';
import { AiModule } from './modules/ai/ai.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { ParticipationModule } from './modules/participation/participation.module';
import { StorageModule } from './modules/storage/storage.module';
import { EconomyModule } from './modules/economy/economy.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { ProductToursModule } from './modules/product-tours/product-tours.module';
import { UserProfileHttpModule } from './modules/users/user-profile-http.module';
import { requestIdMiddleware } from './common/http/request-id.middleware';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    SchedulerModule,
    SystemModule,
    SecurityModule,
    UsersModule,
    AuthModule,
    AdminModule,
    FormsModule,
    AiModule,
    MarketplaceModule,
    ParticipationModule,
    StorageModule,
    EconomyModule,
    NotificationsModule,
    ModerationModule,
    ProductToursModule,
    UserProfileHttpModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Module-level (not `main.ts`) so every Nest app built from AppModule,
   * including the e2e test apps, gets a request id. Runs after the body
   * parser, which keeps the AsyncLocalStorage context intact for handlers.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes('*');
  }
}
