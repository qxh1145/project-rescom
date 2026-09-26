import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { StorageService } from '../application/storage.service';

export const STORAGE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Hourly sweep of lapsed, unattached uploads (Epic 5 review P11). A run never
 * rejects: failures are logged (object ids and error messages only — never
 * storage keys, capabilities or credentials) and the next run carries on.
 * Single-replica only; a multi-replica lease is deferred.
 */
@Injectable()
export class StorageCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly storageService: StorageService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runCleanup();
    }, STORAGE_CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runCleanup(): Promise<void> {
    try {
      const { expired, purged, failures } =
        await this.storageService.cleanupExpired();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} unattached stored object(s).`);
      }
      if (purged > 0) {
        this.logger.log(
          `Purged leftover bytes of ${purged} rejected stored object(s).`,
        );
      }
      for (const failure of failures) {
        this.logger.error(
          `Failed to expire stored object ${failure.objectId}: ${failure.reason}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Storage cleanup run failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }
}
