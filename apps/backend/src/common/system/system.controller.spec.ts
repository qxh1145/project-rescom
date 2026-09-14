import { Test, TestingModule } from '@nestjs/testing';
import { SystemController } from './system.controller';
import { SystemMetricsService } from './system-metrics.service';
import { SystemMetrics } from './system-metrics.interface';
import { SessionAuthGuard } from '../../modules/auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../modules/auth/presentation/guards/roles.guard';

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
});
