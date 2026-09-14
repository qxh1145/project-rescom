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

@Injectable()
export class SystemMetricsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('SystemMetrics');
  private lastCpuUsage: NodeJS.CpuUsage;
  private lastCpuTime: [number, number];
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
  ) {
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = process.hrtime();
  }

  onApplicationBootstrap(): void {
    if (
      this.envService.isTest ||
      this.envService.systemMetricsLogIntervalSeconds <= 0
    ) {
      return;
    }

    // Immediate log on bootstrap
    this.collectMetrics()
      .then((metrics) => this.logSystemMetrics(metrics))
      .catch((err) => {
        this.logger.error('Failed to log initial system metrics', err);
      });

    const intervalMs =
      this.envService.systemMetricsLogIntervalSeconds * 1000;
    this.intervalId = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics();
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

  getCpuMetrics(): CpuMetrics {
    const elapsedHr = process.hrtime(this.lastCpuTime);
    const elapsedMicroseconds = elapsedHr[0] * 1e6 + elapsedHr[1] / 1e3;
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);

    this.lastCpuTime = process.hrtime();
    this.lastCpuUsage = process.cpuUsage();

    const totalCpuMicroseconds =
      currentCpuUsage.user + currentCpuUsage.system;
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
      totalMem > 0 ? Math.round(((usedMem / totalMem) * 100) * 10) / 10 : 0;

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

      const timeoutPromise = (ms: number) =>
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Database query timed out')), ms),
        );

      const [stats, maxConn] = await Promise.all([
        Promise.race([statsQuery, timeoutPromise(3000)]),
        Promise.race([maxConnQuery, timeoutPromise(3000)]),
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

  async collectMetrics(): Promise<SystemMetrics> {
    const uptimeSeconds = Math.round(process.uptime());
    const cpu = this.getCpuMetrics();
    const memory = this.getMemoryMetrics();
    const database = await this.getDatabaseMetrics();

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      cpu,
      memory,
      database,
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
