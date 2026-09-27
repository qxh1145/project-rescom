import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../database/prisma.module';
import { SystemMetricsService } from './system-metrics.service';
import { SystemController } from './system.controller';
import { AuthModule } from '../../modules/auth/auth.module';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule],
  controllers: [SystemController],
  providers: [SystemMetricsService],
  exports: [SystemMetricsService],
})
export class SystemModule {}
