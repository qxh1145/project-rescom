import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SystemMetricsService } from './system-metrics.service';
import { createSuccessEnvelope } from '../http/response.envelope';
import { SessionAuthGuard } from '../../modules/auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../modules/auth/presentation/guards/roles.guard';
import { Roles } from '../../modules/auth/presentation/decorators';

@Controller('system')
export class SystemController {
  constructor(private readonly systemMetricsService: SystemMetricsService) {}

  @Get('metrics')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getMetrics() {
    const metrics = await this.systemMetricsService.collectMetrics();
    return createSuccessEnvelope(metrics);
  }

  @Get('health')
  @SkipThrottle()
  async getHealth() {
    const metrics = await this.systemMetricsService.collectMetrics();
    return createSuccessEnvelope({
      status: metrics.database.status === 'connected' ? 'ok' : 'degraded',
      uptimeSeconds: metrics.uptimeSeconds,
      timestamp: metrics.timestamp,
      database: metrics.database.status,
    });
  }
}
