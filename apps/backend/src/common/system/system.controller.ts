import { Controller, Get } from '@nestjs/common';
import { SystemMetricsService } from './system-metrics.service';
import { createSuccessEnvelope } from '../http/response.envelope';

@Controller('system')
export class SystemController {
  constructor(private readonly systemMetricsService: SystemMetricsService) {}

  @Get('metrics')
  async getMetrics() {
    const metrics = await this.systemMetricsService.collectMetrics();
    return createSuccessEnvelope(metrics);
  }

  @Get('health')
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
