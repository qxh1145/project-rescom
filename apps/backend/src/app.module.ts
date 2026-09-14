import { Module } from '@nestjs/common';
import { ConfigModule } from './common/config/config.module';
import { PrismaModule } from './common/database/prisma.module';
import { SystemModule } from './common/system/system.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    SystemModule,
    UsersModule,
    AuthModule,
    AdminModule,
  ],
})
export class AppModule {}
