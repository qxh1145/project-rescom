import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  assertNotAllFailed,
  JobRunContext,
  JobRunSummary,
  ScheduledJob,
  ScheduledJobRegistry,
} from '../../../common/scheduler/scheduled-job';
import { STORAGE_CLEANUP_JOB } from '../../../common/scheduler/scheduler.constants';
import { StorageService } from '../application/storage.service';

export const STORAGE_CLEANUP_INTERVAL_MS = STORAGE_CLEANUP_JOB.intervalMs;

export interface StorageCleanupCounts {
  expiredCount: number;
  purgedCount: number;
  failedCount: number;
}

/**
 * Hourly sweep of lapsed, unattached uploads (Epic 5 review P11). A run never
 * rejects: failures are logged (object ids and error messages only — never
 * storage keys, capabilities or credentials) and the next run carries on.
 *
 * Story IR.2b Task 13 (Q8; closes 5.3 DF11): a `ScheduledJob` named
 * `storage-cleanup` (1 h, lease 15 min) run by the in-process scheduler, so
 * it holds a PostgreSQL lease instead of its own timer. Consequence: no
 * upload cleanup while `SCHEDULER_ENABLED=false` (local dev).
 */
@Injectable()
export class StorageCleanupService implements OnModuleInit, ScheduledJob {
  readonly name = STORAGE_CLEANUP_JOB.name;
  readonly intervalMs = STORAGE_CLEANUP_JOB.intervalMs;
  readonly leaseTtlMs = STORAGE_CLEANUP_JOB.leaseTtlMs;
  private readonly logger = new Logger(StorageCleanupService.name);

  constructor(
    private readonly storageService: StorageService,
    @Optional() private readonly jobs?: ScheduledJobRegistry,
  ) {}

  onModuleInit(): void {
    this.jobs?.register(this);
  }

  async run(ctx: JobRunContext): Promise<JobRunSummary> {
    const counts = await this.runCleanup(ctx.now);
    // Review LOW-6: a failed run (or one where nothing succeeded) is FAILED.
    assertNotAllFailed(
      this.name,
      counts.failedCount,
      counts.failedCount + counts.expiredCount + counts.purgedCount,
    );
    return {
      status: counts.failedCount > 0 ? 'PARTIAL' : 'SUCCEEDED',
      counts: { ...counts },
      hasMore: false,
    };
  }

  async runCleanup(now: Date = new Date()): Promise<StorageCleanupCounts> {
    try {
      const { expired, purged, failures, purgeFailures, purgeBatchFailure } =
        await this.storageService.cleanupExpired(now);
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
      for (const failure of purgeFailures) {
        this.logger.error(
          `Failed to purge bytes of rejected stored object ${failure.objectId}: ${failure.reason}`,
        );
      }
      if (purgeBatchFailure) {
        this.logger.error(
          `Failed to select rejected stored objects for purge: ${purgeBatchFailure}`,
        );
      }
      return {
        expiredCount: expired,
        purgedCount: purged,
        failedCount:
          failures.length + purgeFailures.length + (purgeBatchFailure ? 1 : 0),
      };
    } catch (error) {
      this.logger.error(
        `Storage cleanup run failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return { expiredCount: 0, purgedCount: 0, failedCount: 1 };
    }
  }
}
