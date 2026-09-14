import { Test, TestingModule } from '@nestjs/testing';
import { SystemMetricsService } from './system-metrics.service';
import { PrismaService } from '../database/prisma.service';
import { EnvService } from '../config/env.service';

describe('SystemMetricsService', () => {
  let service: SystemMetricsService;
  let mockPrisma: { $queryRaw: jest.Mock };
  let mockEnv: {
    isTest: boolean;
    isProduction: boolean;
    systemMetricsLogIntervalSeconds: number;
  };

  beforeEach(async () => {
    mockPrisma = {
      $queryRaw: jest.fn(),
    };

    mockEnv = {
      isTest: true,
      isProduction: false,
      systemMetricsLogIntervalSeconds: 30,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemMetricsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: EnvService,
          useValue: mockEnv,
        },
      ],
    }).compile();

    service = module.get<SystemMetricsService>(SystemMetricsService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('CPU Metrics', () => {
    it('should return valid CPU metrics', () => {
      const cpu = service.getCpuMetrics();
      expect(typeof cpu.processPercent).toBe('number');
      expect(cpu.processPercent).toBeGreaterThanOrEqual(0);
      expect(typeof cpu.normalizedPercent).toBe('number');
      expect(cpu.cores).toBeGreaterThanOrEqual(1);
      expect(cpu.loadAvg).toHaveLength(3);
    });
  });

  describe('Memory Metrics', () => {
    it('should return valid RAM/Memory metrics', () => {
      const mem = service.getMemoryMetrics();
      expect(mem.heapUsedMb).toBeGreaterThan(0);
      expect(mem.heapTotalMb).toBeGreaterThanOrEqual(mem.heapUsedMb);
      expect(mem.rssMb).toBeGreaterThan(0);
      expect(mem.systemTotalGb).toBeGreaterThan(0);
      expect(mem.systemUsedPercent).toBeGreaterThanOrEqual(0);
      expect(mem.systemUsedPercent).toBeLessThanOrEqual(100);
    });
  });

  describe('Database Connection Metrics', () => {
    it('should return connected stats when pg_stat_activity query succeeds', async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([
          {
            totalConnections: 12,
            activeConnections: 3,
            idleConnections: 9,
            idleInTransactionConnections: 0,
            distinctClientIps: 2,
          },
        ])
        .mockResolvedValueOnce([{ max_connections: '100' }]);

      const db = await service.getDatabaseMetrics();

      expect(db.status).toBe('connected');
      expect(db.totalConnections).toBe(12);
      expect(db.activeConnections).toBe(3);
      expect(db.idleConnections).toBe(9);
      expect(db.distinctClientIps).toBe(2);
      expect(db.maxConnections).toBe(100);
      expect(db.error).toBeUndefined();
    });

    it('should gracefully handle database connection error without throwing', async () => {
      mockPrisma.$queryRaw.mockRejectedValueOnce(
        new Error("Can't reach database server at localhost:5433"),
      );

      const db = await service.getDatabaseMetrics();

      expect(db.status).toBe('disconnected');
      expect(db.totalConnections).toBeNull();
      expect(db.activeConnections).toBeNull();
      expect(db.error).toContain("Can't reach database server");
    });
  });

  describe('collectMetrics', () => {
    it('should collect combined system metrics', async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([
          {
            totalConnections: 5,
            activeConnections: 1,
            idleConnections: 4,
            idleInTransactionConnections: 0,
            distinctClientIps: 1,
          },
        ])
        .mockResolvedValueOnce([{ max_connections: '100' }]);

      const metrics = await service.collectMetrics();

      expect(metrics.timestamp).toBeDefined();
      expect(metrics.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(metrics.cpu).toBeDefined();
      expect(metrics.memory).toBeDefined();
      expect(metrics.database.status).toBe('connected');
    });
  });

  describe('Logging', () => {
    it('should log formatted human-readable metrics in development', async () => {
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation();

      const metrics = await service.collectMetrics();
      service.logSystemMetrics(metrics);

      expect(logSpy).toHaveBeenCalled();
      const loggedMessage = logSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('System Health & Resource Monitor');
      expect(loggedMessage).toContain('CPU');
      expect(loggedMessage).toContain('RAM');
      expect(loggedMessage).toContain('DB');
    });

    it('should log structured JSON metrics in production', async () => {
      mockEnv.isProduction = true;
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation();

      const metrics = await service.collectMetrics();
      service.logSystemMetrics(metrics);

      expect(logSpy).toHaveBeenCalled();
      const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(loggedJson.type).toBe('SYSTEM_METRICS');
      expect(loggedJson.cpu).toBeDefined();
      expect(loggedJson.memory).toBeDefined();
      expect(loggedJson.database).toBeDefined();
    });
  });

  describe('Lifecycle', () => {
    it('should not start periodic timer when isTest is true', () => {
      const collectSpy = jest.spyOn(service, 'collectMetrics');
      service.onApplicationBootstrap();
      expect(collectSpy).not.toHaveBeenCalled();
    });

    it('should cleanly destroy timer on module destroy', () => {
      (service as any).intervalId = setInterval(() => {}, 10000);
      service.onModuleDestroy();
      expect((service as any).intervalId).toBeNull();
    });
  });
});
