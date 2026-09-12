import { Module } from '@nestjs/common';
import { ConfigModule } from './common/config/config.module';
import { PrismaModule } from './common/database/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [ConfigModule, PrismaModule, UsersModule, AuthModule],
})
export class AppModule {}
