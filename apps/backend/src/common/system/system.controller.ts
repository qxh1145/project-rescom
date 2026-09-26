import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SystemMetricsService } from './system-metrics.service';
import { createSuccessEnvelope } from '../http/response.envelope';
import { SessionAuthGuard } from '../../modules/auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../modules/auth/presentation/guards/roles.guard';
import { Roles } from '../../modules/auth/presentation/decorators';

@Controller(['system', 'api/system'])
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
  // BE-10: was fully exempt from throttling, letting a naive polling client
  // hammer collectMetrics()/DB unbounded. A generous per-minute cap still
  // allows normal health-check polling while capping abuse.
  @Throttle({ default: { limit: 60, ttl: 60000 } })
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
