import {
  Controller,
  Get,
  Inject,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../database/prisma.service';
import { createSuccessEnvelope } from '../http/response.envelope';
import { SchedulerHealthService } from '../scheduler/scheduler-health.service';
import {
  MALWARE_SCANNER_PORT,
  MalwareScannerPort,
} from '../../modules/storage/application/ports/malware-scanner.port';

const CHECK_TIMEOUT_MS = 2000;
const READY_CACHE_MS = 5000;

interface ReadyChecks {
  database: 'up' | 'down';
  scanner: 'up' | 'down';
  scheduler: 'ok' | 'degraded' | 'disabled';
}

/**
 * Story 11.1 Task 3: unauthenticated probes for Docker/uptime monitors. They
 * poll from one IP, so every named throttler bucket is skipped; `/ready` is
 * instead bounded by a short result cache. Bodies never carry error text.
 */
@SkipThrottle({ default: true, auth: true })
@Controller(['health', 'api/health'])
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private cache: { at: number; value: Promise<ReadyChecks> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MALWARE_SCANNER_PORT) private readonly scanner: MalwareScannerPort,
    @Optional() private readonly schedulerHealth?: SchedulerHealthService,
  ) {}

  @Get('live')
  live() {
    return createSuccessEnvelope({ status: 'ok' });
  }

  @Get('ready')
  async ready() {
    const checks = await this.cachedChecks();
    if (checks.database === 'down' || checks.scanner === 'down') {
      // The filter forwards `code` and `details` of an HttpException body.
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'Service is not ready.',
        details: checks,
      });
    }
    return createSuccessEnvelope({ status: 'ready', checks });
  }

  private cachedChecks(): Promise<ReadyChecks> {
    const now = Date.now();
    if (!this.cache || now - this.cache.at > READY_CACHE_MS) {
      // Checks never reject (failures become 'down'), so no rejection is cached.
      this.cache = { at: now, value: this.runChecks() };
    }
    return this.cache.value;
  }

  private async runChecks(): Promise<ReadyChecks> {
    const [database, scanner, scheduler] = await Promise.all([
      this.probe('database', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return true;
      }),
      this.probe('scanner', () => this.scanner.ping()),
      this.schedulerStatus(),
    ]);
    return {
      database: database ? 'up' : 'down',
      scanner: scanner ? 'up' : 'down',
      scheduler,
    };
  }

  private async probe(
    name: string,
    check: () => Promise<boolean>,
  ): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const ok = await Promise.race([
        check(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timed out')),
            CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      if (!ok)
        this.logger.warn(`Readiness check "${name}" failed: unreachable`);
      return ok;
    } catch (error) {
      this.logger.warn(
        `Readiness check "${name}" failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Informational only: never fails readiness. Bounded within CHECK_TIMEOUT_MS so a slow DB cannot hang readiness. */
  private async schedulerStatus(): Promise<ReadyChecks['scheduler']> {
    if (!this.schedulerHealth) return 'disabled';
    let timer: NodeJS.Timeout | undefined;
    try {
      const snapshot = await Promise.race([
        this.schedulerHealth.cachedSnapshot(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timed out')),
            CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return snapshot.status;
    } catch {
      return 'degraded';
    } finally {
      clearTimeout(timer);
    }
  }
}
