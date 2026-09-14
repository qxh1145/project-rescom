import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './common/config/config.module';
import { PrismaModule } from './common/database/prisma.module';
import { SystemModule } from './common/system/system.module';
import { SecurityModule } from './common/security/security.module';
import { AppThrottlerGuard } from './common/security/app-throttler.guard';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    SystemModule,
    SecurityModule,
    UsersModule,
    AuthModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule {}
