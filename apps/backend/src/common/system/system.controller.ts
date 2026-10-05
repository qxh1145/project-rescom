import { Controller, Get, Optional, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SystemMetricsService } from './system-metrics.service';
import { createSuccessEnvelope } from '../http/response.envelope';
import { SessionAuthGuard } from '../../modules/auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../modules/auth/presentation/guards/roles.guard';
import { Roles } from '../../modules/auth/presentation/decorators';
import {
  SchedulerHealthService,
  SchedulerHealthSnapshot,
} from '../scheduler/scheduler-health.service';

@Controller(['system', 'api/system'])
export class SystemController {
  constructor(
    private readonly systemMetricsService: SystemMetricsService,
    /** Story IR.2b Task 10.3; absent when the SchedulerModule is not loaded. */
    @Optional() private readonly schedulerHealth?: SchedulerHealthService,
  ) {}

  /** Never fails the endpoint: an unreadable snapshot reports `degraded`. */
  private async schedulerSnapshot(
    cached = false,
  ): Promise<SchedulerHealthSnapshot | null> {
    if (!this.schedulerHealth) return null;
    try {
      return await (cached
        ? this.schedulerHealth.cachedSnapshot()
        : this.schedulerHealth.snapshot());
    } catch {
      return {
        enabled: this.schedulerHealth.enabled,
        status: this.schedulerHealth.enabled ? 'degraded' : 'disabled',
        jobs: [],
        outbox: {
          pending: 0,
          retrying: 0,
          deadLetter: 0,
          oldestAvailableAgeSeconds: null,
          unsubscribedPending: 0,
        },
      };
    }
  }

  @Get('metrics')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getMetrics() {
    const [metrics, scheduler] = await Promise.all([
      this.systemMetricsService.collectMetrics(),
      this.schedulerSnapshot(),
    ]);
    return createSuccessEnvelope(
      scheduler ? { ...metrics, scheduler } : metrics,
    );
  }

  @Get('health')
  // BE-10: was fully exempt from throttling, letting a naive polling client
  // hammer collectMetrics()/DB unbounded. A generous per-minute cap still
  // allows normal health-check polling while capping abuse.
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async getHealth() {
    const [metrics, scheduler] = await Promise.all([
      this.systemMetricsService.collectMetrics(),
      // Review LOW-11: the public endpoint reuses a ~10 s snapshot.
      this.schedulerSnapshot(true),
    ]);
    return createSuccessEnvelope({
      status: metrics.database.status === 'connected' ? 'ok' : 'degraded',
      uptimeSeconds: metrics.uptimeSeconds,
      timestamp: metrics.timestamp,
      database: metrics.database.status,
      // Story IR.2b: public payload stays minimal (no counts).
      ...(scheduler
        ? {
            scheduler: { enabled: scheduler.enabled, status: scheduler.status },
          }
        : {}),
    });
  }
}
