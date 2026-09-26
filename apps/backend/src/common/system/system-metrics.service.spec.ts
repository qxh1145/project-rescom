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

    it('keeps the periodic logger baseline isolated from on-demand probes (BE-10)', () => {
      const periodicBaseline = (service as any).periodicCpuBaseline;
      const onDemandBaseline = (service as any).onDemandCpuBaseline;
      expect(periodicBaseline).not.toBe(onDemandBaseline);

      const periodicTimeBefore = periodicBaseline.lastCpuTime;
      const periodicUsageBefore = periodicBaseline.lastCpuUsage;

      // Repeated on-demand sampling (default baseline) must not disturb the
      // periodic logger's own baseline.
      service.getCpuMetrics();
      service.getCpuMetrics();

      expect(periodicBaseline.lastCpuTime).toBe(periodicTimeBefore);
      expect(periodicBaseline.lastCpuUsage).toBe(periodicUsageBefore);

      const onDemandTimeBefore = onDemandBaseline.lastCpuTime;
      const onDemandUsageBefore = onDemandBaseline.lastCpuUsage;

      // Sampling against the periodic baseline (as the background logger
      // does) must not disturb the on-demand baseline either.
      service.getCpuMetrics(periodicBaseline);

      expect(onDemandBaseline.lastCpuTime).toBe(onDemandTimeBefore);
      expect(onDemandBaseline.lastCpuUsage).toBe(onDemandUsageBefore);
      // ...but it must have updated its own baseline.
      expect(periodicBaseline.lastCpuTime).not.toBe(periodicTimeBefore);
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

    it('clears the internal query-timeout timers once both queries settle (BE-10)', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([
          {
            totalConnections: 1,
            activeConnections: 1,
            idleConnections: 0,
            idleInTransactionConnections: 0,
            distinctClientIps: 1,
          },
        ])
        .mockResolvedValueOnce([{ max_connections: '100' }]);

      await service.getDatabaseMetrics();

      // One race (and one timer) per query: stats + max_connections.
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);

      clearTimeoutSpy.mockRestore();
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

    it('memoizes the result within the cache window and shares the in-flight promise (BE-10)', async () => {
      let resolveQuery!: (value: unknown) => void;
      const pendingQuery = new Promise((resolve) => {
        resolveQuery = resolve;
      });
      mockPrisma.$queryRaw.mockReturnValue(pendingQuery);

      // Two concurrent callers before the DB query even settles.
      const call1 = service.collectMetrics();
      const call2 = service.collectMetrics();

      resolveQuery([
        {
          totalConnections: 1,
          activeConnections: 1,
          idleConnections: 0,
          idleInTransactionConnections: 0,
          distinctClientIps: 1,
          max_connections: '100',
        },
      ]);

      const [result1, result2] = await Promise.all([call1, call2]);
      expect(result1).toBe(result2);
      // Only one collection ran: one query for stats, one for max_connections.
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);

      // Still within the TTL: the cached result is reused, no new queries.
      const result3 = await service.collectMetrics();
      expect(result3).toBe(result1);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('recomputes once the cache TTL has elapsed (BE-10)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          totalConnections: 1,
          activeConnections: 1,
          idleConnections: 0,
          idleInTransactionConnections: 0,
          distinctClientIps: 1,
          max_connections: '100',
        },
      ]);

      const nowSpy = jest.spyOn(Date, 'now');
      try {
        nowSpy.mockReturnValue(1_000_000);
        const first = await service.collectMetrics();
        expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);

        nowSpy.mockReturnValue(1_000_000 + 500);
        const cached = await service.collectMetrics();
        expect(cached).toBe(first);
        expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);

        nowSpy.mockReturnValue(1_000_000 + 2500);
        const fresh = await service.collectMetrics();
        expect(fresh).not.toBe(first);
        expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(4);
      } finally {
        nowSpy.mockRestore();
      }
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
