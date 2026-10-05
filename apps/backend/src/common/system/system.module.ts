import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../database/prisma.module';
import { SystemMetricsService } from './system-metrics.service';
import { SystemController } from './system.controller';
import { HealthController } from './health.controller';
import { StorageModule } from '../../modules/storage/storage.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { AdminOutboxController } from '../scheduler/outbox/admin-outbox.controller';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule, StorageModule],
  // Story IR.2b Task 4.7: the Admin dead-letter operations live with the
  // other operator endpoints (the SchedulerModule is global, AuthModule here).
  controllers: [SystemController, HealthController, AdminOutboxController],
  providers: [SystemMetricsService],
  exports: [SystemMetricsService],
})
export class SystemModule {}
