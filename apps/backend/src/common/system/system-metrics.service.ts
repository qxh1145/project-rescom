import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import * as os from 'os';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { EnvService } from '../config/env.service';
import {
  CpuMetrics,
  DatabaseMetrics,
  MemoryMetrics,
  SystemMetrics,
} from './system-metrics.interface';
import { storageOutagesSinceBoot } from './storage-outage-counter';

/**
 * BE-10: a CPU sampling baseline. Kept separate per consumer so that an
 * on-demand probe (e.g. a burst of /system/health requests) does not
 * overwrite the baseline the periodic background logger relies on to
 * compute its own CPU delta, and vice versa.
 */
interface CpuBaseline {
  lastCpuUsage: NodeJS.CpuUsage;
  lastCpuTime: [number, number];
}

@Injectable()
export class SystemMetricsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('SystemMetrics');
  private intervalId: NodeJS.Timeout | null = null;

  private readonly periodicCpuBaseline: CpuBaseline;
  private readonly onDemandCpuBaseline: CpuBaseline;

  // BE-10: collectMetrics() is memoized for a short window (with the
  // in-flight promise shared too) so a burst of concurrent on-demand callers
  // (health checks, dashboards) doesn't each pay for a fresh DB round trip
  // and CPU sample.
  private static readonly METRICS_CACHE_TTL_MS = 2000;
  private cachedMetrics: { expiresAt: number; metrics: SystemMetrics } | null =
    null;
  private inFlightMetrics: Promise<SystemMetrics> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
  ) {
    this.periodicCpuBaseline = {
      lastCpuUsage: process.cpuUsage(),
      lastCpuTime: process.hrtime(),
    };
    this.onDemandCpuBaseline = {
      lastCpuUsage: process.cpuUsage(),
      lastCpuTime: process.hrtime(),
    };
  }

  onApplicationBootstrap(): void {
    if (
      this.envService.isTest ||
      this.envService.systemMetricsLogIntervalSeconds <= 0
    ) {
      return;
    }

    // Immediate log on bootstrap. The periodic logger always uses its own
    // baseline and bypasses the on-demand cache so it reflects the interval
    // that just elapsed, not whatever an unrelated caller last cached.
    this.collectMetricsUncached(this.periodicCpuBaseline)
      .then((metrics) => this.logSystemMetrics(metrics))
      .catch((err) => {
        this.logger.error('Failed to log initial system metrics', err);
      });

    const intervalMs = this.envService.systemMetricsLogIntervalSeconds * 1000;
    this.intervalId = setInterval(async () => {
      try {
        const metrics = await this.collectMetricsUncached(
          this.periodicCpuBaseline,
        );
        this.logSystemMetrics(metrics);
      } catch (err) {
        this.logger.error('Failed to collect system metrics', err);
      }
    }, intervalMs);

    if (this.intervalId.unref) {
      this.intervalId.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getCpuMetrics(baseline: CpuBaseline = this.onDemandCpuBaseline): CpuMetrics {
    const elapsedHr = process.hrtime(baseline.lastCpuTime);
    const elapsedMicroseconds = elapsedHr[0] * 1e6 + elapsedHr[1] / 1e3;
    const currentCpuUsage = process.cpuUsage(baseline.lastCpuUsage);

    baseline.lastCpuTime = process.hrtime();
    baseline.lastCpuUsage = process.cpuUsage();

    const totalCpuMicroseconds = currentCpuUsage.user + currentCpuUsage.system;
    const cores = os.cpus()?.length || 1;
    const processPercent =
      elapsedMicroseconds > 0
        ? Math.round((totalCpuMicroseconds / elapsedMicroseconds) * 1000) / 10
        : 0;
    const normalizedPercent = Math.round((processPercent / cores) * 10) / 10;
    const rawLoad = os.loadavg() || [0, 0, 0];
    const loadAvg: [number, number, number] = [
      Math.round(rawLoad[0] * 100) / 100,
      Math.round(rawLoad[1] * 100) / 100,
      Math.round(rawLoad[2] * 100) / 100,
    ];

    return {
      processPercent,
      normalizedPercent,
      cores,
      loadAvg,
    };
  }

  getMemoryMetrics(): MemoryMetrics {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const toMb = (bytes: number) =>
      Math.round((bytes / 1024 / 1024) * 100) / 100;
    const toGb = (bytes: number) =>
      Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100;
    const systemUsedPercent =
      totalMem > 0 ? Math.round((usedMem / totalMem) * 100 * 10) / 10 : 0;

    return {
      heapUsedMb: toMb(mem.heapUsed),
      heapTotalMb: toMb(mem.heapTotal),
      rssMb: toMb(mem.rss),
      externalMb: toMb(mem.external),
      systemTotalGb: toGb(totalMem),
      systemFreeGb: toGb(freeMem),
      systemUsedGb: toGb(usedMem),
      systemUsedPercent,
    };
  }

  async getDatabaseMetrics(): Promise<DatabaseMetrics> {
    try {
      const statsQuery = this.prisma.$queryRaw<
        Array<{
          totalConnections: number | bigint;
          activeConnections: number | bigint;
          idleConnections: number | bigint;
          idleInTransactionConnections: number | bigint;
          distinctClientIps: number | bigint;
        }>
      >(Prisma.sql`
        SELECT
          count(*)::int AS "totalConnections",
          count(*) FILTER (WHERE state = 'active')::int AS "activeConnections",
          count(*) FILTER (WHERE state = 'idle')::int AS "idleConnections",
          count(*) FILTER (WHERE state = 'idle in transaction')::int AS "idleInTransactionConnections",
          count(DISTINCT client_addr)::int AS "distinctClientIps"
        FROM pg_stat_activity
        WHERE datname = current_database();
      `);

      const maxConnQuery = this.prisma.$queryRaw<
        Array<{ max_connections: string }>
      >(Prisma.sql`SHOW max_connections;`);

      // BE-10: each race's timer must be cleared once its promise settles
      // (either way), or a timer per collectMetrics() call leaks until it
      // fires on its own several seconds later.
      const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
        let timeoutHandle: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('Database query timed out')),
            ms,
          );
        });
        return Promise.race([promise, timeoutPromise]).finally(() => {
          clearTimeout(timeoutHandle);
        });
      };

      const [stats, maxConn] = await Promise.all([
        withTimeout(statsQuery, 3000),
        withTimeout(maxConnQuery, 3000),
      ]);

      const stat = stats[0];
      const maxVal = maxConn[0]?.max_connections;

      return {
        status: 'connected',
        totalConnections: stat ? Number(stat.totalConnections) : 0,
        activeConnections: stat ? Number(stat.activeConnections) : 0,
        idleConnections: stat ? Number(stat.idleConnections) : 0,
        idleInTransactionConnections: stat
          ? Number(stat.idleInTransactionConnections)
          : 0,
        distinctClientIps: stat ? Number(stat.distinctClientIps) : 0,
        maxConnections: maxVal ? parseInt(maxVal, 10) : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cleanMessage =
        message.length > 150 ? `${message.substring(0, 150)}...` : message;
      return {
        status: 'disconnected',
        totalConnections: null,
        activeConnections: null,
        idleConnections: null,
        idleInTransactionConnections: null,
        distinctClientIps: null,
        maxConnections: null,
        error: cleanMessage,
      };
    }
  }

  /**
   * Public entry point used by on-demand callers (the /system controller
   * endpoints). Memoized for METRICS_CACHE_TTL_MS: a burst of concurrent
   * calls within that window share one in-flight computation and its
   * result, instead of each re-querying the database and re-sampling CPU
   * against the on-demand baseline.
   */
  async collectMetrics(): Promise<SystemMetrics> {
    const now = Date.now();
    if (this.cachedMetrics && this.cachedMetrics.expiresAt > now) {
      return this.cachedMetrics.metrics;
    }
    if (this.inFlightMetrics) {
      return this.inFlightMetrics;
    }

    const inFlight = this.collectMetricsUncached(this.onDemandCpuBaseline)
      .then((metrics) => {
        this.cachedMetrics = {
          metrics,
          expiresAt: Date.now() + SystemMetricsService.METRICS_CACHE_TTL_MS,
        };
        return metrics;
      })
      .finally(() => {
        this.inFlightMetrics = null;
      });

    this.inFlightMetrics = inFlight;
    return inFlight;
  }

  private async collectMetricsUncached(
    cpuBaseline: CpuBaseline,
  ): Promise<SystemMetrics> {
    const uptimeSeconds = Math.round(process.uptime());
    const cpu = this.getCpuMetrics(cpuBaseline);
    const memory = this.getMemoryMetrics();
    const database = await this.getDatabaseMetrics();

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      cpu,
      memory,
      database,
      storage: { outagesSinceBoot: storageOutagesSinceBoot() },
    };
  }

  logSystemMetrics(metrics: SystemMetrics): void {
    const dbInfo =
      metrics.database.status === 'connected'
        ? `Connected | ${metrics.database.activeConnections} active / ${metrics.database.idleConnections} idle / ${metrics.database.totalConnections} total (Max: ${metrics.database.maxConnections ?? 'N/A'}, Client IPs: ${metrics.database.distinctClientIps})`
        : `Disconnected (${metrics.database.error ?? 'Unreachable'})`;

    if (this.envService.isProduction) {
      this.logger.log(
        JSON.stringify({
          type: 'SYSTEM_METRICS',
          ...metrics,
        }),
      );
    } else {
      this.logger.log(
        `\n  ┌── 📊 System Health & Resource Monitor ──────────────────────────────────────────\n` +
          `  │ CPU  : Process ${metrics.cpu.processPercent}% | Host ${metrics.cpu.normalizedPercent}% (${metrics.cpu.cores} cores) | Load [${metrics.cpu.loadAvg.join(', ')}]\n` +
          `  │ RAM  : Heap ${metrics.memory.heapUsedMb} MB / ${metrics.memory.heapTotalMb} MB | RSS ${metrics.memory.rssMb} MB | System ${metrics.memory.systemUsedGb} GB / ${metrics.memory.systemTotalGb} GB (${metrics.memory.systemUsedPercent}%)\n` +
          `  │ DB   : ${dbInfo}\n` +
          `  └─────────────────────────────────────────────────────────────────────────`,
      );
    }
  }
}
