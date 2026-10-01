import { Test, TestingModule } from '@nestjs/testing';
import { SystemController } from './system.controller';
import { SystemMetricsService } from './system-metrics.service';
import { SystemMetrics } from './system-metrics.interface';
import { SessionAuthGuard } from '../../modules/auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../modules/auth/presentation/guards/roles.guard';
import { SchedulerHealthService } from '../scheduler/scheduler-health.service';

describe('SystemController', () => {
  let controller: SystemController;
  let mockMetricsService: { collectMetrics: jest.Mock };

  const sampleMetrics: SystemMetrics = {
    timestamp: '2026-09-14T12:00:00.000Z',
    uptimeSeconds: 120,
    cpu: {
      processPercent: 1.5,
      normalizedPercent: 0.2,
      cores: 8,
      loadAvg: [1.2, 1.0, 0.8],
    },
    memory: {
      heapUsedMb: 45.5,
      heapTotalMb: 70.0,
      rssMb: 110.0,
      externalMb: 5.0,
      systemTotalGb: 16.0,
      systemFreeGb: 8.0,
      systemUsedGb: 8.0,
      systemUsedPercent: 50.0,
    },
    database: {
      status: 'connected',
      totalConnections: 10,
      activeConnections: 2,
      idleConnections: 8,
      idleInTransactionConnections: 0,
      distinctClientIps: 1,
      maxConnections: 100,
    },
  };

  beforeEach(async () => {
    mockMetricsService = {
      collectMetrics: jest.fn().mockResolvedValue(sampleMetrics),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [
        {
          provide: SystemMetricsService,
          useValue: mockMetricsService,
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<SystemController>(SystemController);
  });

  it('should return metrics envelope', async () => {
    const response = await controller.getMetrics();
    expect(response.error).toBeNull();
    expect(response.data).toEqual(sampleMetrics);
  });

  it('should return health envelope with ok status when DB is connected', async () => {
    const response = await controller.getHealth();
    expect(response.error).toBeNull();
    expect(response.data).toEqual({
      status: 'ok',
      uptimeSeconds: 120,
      timestamp: '2026-09-14T12:00:00.000Z',
      database: 'connected',
    });
  });

  it('should return degraded health status when DB is disconnected', async () => {
    mockMetricsService.collectMetrics.mockResolvedValueOnce({
      ...sampleMetrics,
      database: {
        status: 'disconnected',
        totalConnections: null,
        activeConnections: null,
        idleConnections: null,
        idleInTransactionConnections: null,
        distinctClientIps: null,
        maxConnections: null,
        error: 'Connection timeout',
      },
    });

    const response = await controller.getHealth();
    expect(response.error).toBeNull();
    expect(response.data?.status).toBe('degraded');
    expect(response.data?.database).toBe('disconnected');
  });

  it('throttles the health endpoint instead of skipping it entirely (BE-10)', () => {
    const handler = SystemController.prototype.getHealth;

    expect(
      Reflect.getMetadata('THROTTLER:SKIPdefault', handler),
    ).toBeUndefined();
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(60);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60000);
  });

  describe('scheduler health (Story IR.2b Task 10.3, T18)', () => {
    const snapshot = {
      enabled: true,
      status: 'degraded' as const,
      jobs: [
        {
          name: 'outbox-dispatch',
          lastStatus: 'FAILED',
          lastFinishedAt: null,
          nextRunAt: null,
          consecutiveFailures: 3,
          overdue: false,
        },
      ],
      outbox: {
        pending: 4,
        retrying: 1,
        deadLetter: 2,
        oldestAvailableAgeSeconds: 30,
        unsubscribedPending: 121,
      },
    };

    async function withScheduler(health: Record<string, unknown>) {
      const module = await Test.createTestingModule({
        controllers: [SystemController],
        providers: [
          { provide: SystemMetricsService, useValue: mockMetricsService },
          { provide: SchedulerHealthService, useValue: health },
        ],
      })
        .overrideGuard(SessionAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(RolesGuard)
        .useValue({ canActivate: () => true })
        .compile();
      return module.get(SystemController);
    }

    it('health adds only enabled + status (no counts)', async () => {
      const scheduled = await withScheduler({
        enabled: true,
        cachedSnapshot: jest.fn().mockResolvedValue(snapshot),
      });
      const response = await scheduled.getHealth();
      expect(response.data).toMatchObject({
        status: 'ok',
        scheduler: { enabled: true, status: 'degraded' },
      });
      expect(JSON.stringify(response.data)).not.toContain('deadLetter');
    });

    it('metrics (Admin) carry the full snapshot', async () => {
      const scheduled = await withScheduler({
        enabled: true,
        snapshot: jest.fn().mockResolvedValue(snapshot),
      });
      const response = await scheduled.getMetrics();
      expect(response.data).toEqual({ ...sampleMetrics, scheduler: snapshot });
    });

    it('an unreadable snapshot never fails the endpoint', async () => {
      const scheduled = await withScheduler({
        enabled: false,
        cachedSnapshot: jest.fn().mockRejectedValue(new Error('db down')),
      });
      const response = await scheduled.getHealth();
      expect(response.data).toMatchObject({
        scheduler: { enabled: false, status: 'disabled' },
      });
    });
  });
});
