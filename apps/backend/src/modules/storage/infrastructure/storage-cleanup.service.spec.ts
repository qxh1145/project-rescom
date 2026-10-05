import { Logger } from '@nestjs/common';
import { StorageCleanupService } from './storage-cleanup.service';
import {
  JobRunContext,
  ScheduledJobRegistry,
} from '../../../common/scheduler/scheduled-job';
import { StorageService } from '../application/storage.service';
import { StoredObjectEntity } from '../domain/stored-object.entity';
import { InMemoryStorageRepository } from './in-memory-storage.repository';
import { InMemoryObjectStorageService } from './in-memory-object-storage.service';
import { StubMalwareScannerService } from './stub-malware-scanner.service';

describe('StorageCleanupService (P11)', () => {
  let storageService: { cleanupExpired: jest.Mock };
  let cleanup: StorageCleanupService;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    storageService = { cleanupExpired: jest.fn() };
    cleanup = new StorageCleanupService(
      storageService as unknown as StorageService,
    );
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('never rejects when a whole run fails, and logs the failure', async () => {
    storageService.cleanupExpired.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(cleanup.runCleanup()).resolves.toEqual({
      expiredCount: 0,
      purgedCount: 0,
      failedCount: 1,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Storage cleanup run failed: database unavailable',
    );
  });

  it('logs each object that could not be expired', async () => {
    storageService.cleanupExpired.mockResolvedValue({
      expired: 2,
      purged: 0,
      failures: [{ objectId: 'object-1', reason: 'storage unavailable' }],
      purgeFailures: [{ objectId: 'object-2', reason: 'AccessDenied' }],
      purgeBatchFailure: 'database unavailable',
    });

    await cleanup.runCleanup();

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to expire stored object object-1: storage unavailable',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to purge bytes of rejected stored object object-2: AccessDenied',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to select rejected stored objects for purge: database unavailable',
    );
  });

  it('purges lapsed REJECTED objects without expiring them (F1)', async () => {
    const repository = new InMemoryStorageRepository();
    const objectStorage = new InMemoryObjectStorageService();
    // Past the upload window and the 5-minute purge margin.
    const lapsed = new Date(Date.now() - 10 * 60 * 1000);
    const stored = (id: string, status: 'REJECTED' | 'INITIATED') =>
      new StoredObjectEntity(
        id,
        'participation',
        'attempt-1',
        'SURVEY_ATTACHMENT',
        `participation/attempt-1/${id}-file.pdf`,
        'rescom-private-storage',
        'file.pdf',
        1024,
        'application/pdf',
        null,
        status,
        status === 'REJECTED' ? 'INFECTED' : 'PENDING',
        null,
        null,
        null,
        null,
        null,
        lapsed,
      );
    await repository.save(stored('rejected-1', 'REJECTED'));
    await repository.save(stored('initiated-1', 'INITIATED'));
    objectStorage.putObject(
      'rescom-private-storage',
      'participation/attempt-1/rejected-1-file.pdf',
      'leftover',
      'application/pdf',
    );
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    const realCleanup = new StorageCleanupService(
      new StorageService(
        repository,
        objectStorage,
        new StubMalwareScannerService(),
      ),
    );

    await realCleanup.runCleanup();

    const rejected = await repository.findById('rejected-1');
    expect(rejected?.status).toBe('REJECTED');
    expect(rejected?.expiresAt).toBeNull();
    expect(
      objectStorage.hasObject(
        'rescom-private-storage',
        'participation/attempt-1/rejected-1-file.pdf',
      ),
    ).toBe(false);
    expect((await repository.findById('initiated-1'))?.status).toBe('EXPIRED');
    expect(logSpy).toHaveBeenCalledWith(
      'Purged leftover bytes of 1 rejected stored object(s).',
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  describe('as the `storage-cleanup` scheduled job (Story IR.2b Task 13)', () => {
    const ctx = (now: Date): JobRunContext => ({
      runId: 'run-1',
      now,
      owner: 'owner',
      fencingToken: '1',
      shouldContinue: async () => true,
      logger: { log() {}, warn() {}, error() {}, debug() {} },
    });

    it('registers itself with the scheduler instead of its own timer', () => {
      const registry = new ScheduledJobRegistry();
      const job = new StorageCleanupService(
        storageService as unknown as StorageService,
        registry,
      );
      job.onModuleInit();

      expect(registry.get('storage-cleanup')).toBe(job);
      expect(job.intervalMs).toBe(60 * 60 * 1000);
      expect(job.leaseTtlMs).toBe(15 * 60 * 1000);
    });

    it('passes the run time and reports counts only', async () => {
      const now = new Date('2026-10-01T10:00:00.000Z');
      storageService.cleanupExpired.mockResolvedValue({
        expired: 3,
        purged: 1,
        failures: [{ objectId: 'object-1', reason: 'storage unavailable' }],
        purgeFailures: [],
        purgeBatchFailure: null,
      });

      await expect(cleanup.run(ctx(now))).resolves.toEqual({
        status: 'PARTIAL',
        counts: { expiredCount: 3, purgedCount: 1, failedCount: 1 },
        hasMore: false,
      });
      expect(storageService.cleanupExpired).toHaveBeenCalledWith(now);
    });

    it('a failed run is reported FAILED to the runner (review LOW-6)', async () => {
      storageService.cleanupExpired.mockRejectedValue(new Error('boom'));

      await expect(cleanup.run(ctx(new Date()))).rejects.toMatchObject({
        code: 'ALL_ITEMS_FAILED',
      });
      expect(errorSpy).toHaveBeenCalledWith('Storage cleanup run failed: boom');
    });
  });
});
