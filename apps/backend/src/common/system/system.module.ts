import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../database/prisma.module';
import { SystemMetricsService } from './system-metrics.service';
import { SystemController } from './system.controller';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [SystemController],
  providers: [SystemMetricsService],
  exports: [SystemMetricsService],
})
export class SystemModule {}
