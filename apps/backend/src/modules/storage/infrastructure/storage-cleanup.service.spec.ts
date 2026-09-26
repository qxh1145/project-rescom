import { Logger } from '@nestjs/common';
import {
  STORAGE_CLEANUP_INTERVAL_MS,
  StorageCleanupService,
} from './storage-cleanup.service';
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
    cleanup.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('never rejects when a whole run fails, and logs the failure', async () => {
    storageService.cleanupExpired.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(cleanup.runCleanup()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'Storage cleanup run failed: database unavailable',
    );
  });

  it('logs each object that could not be expired', async () => {
    storageService.cleanupExpired.mockResolvedValue({
      expired: 2,
      failures: [{ objectId: 'object-1', reason: 'storage unavailable' }],
    });

    await cleanup.runCleanup();

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to expire stored object object-1: storage unavailable',
    );
  });

  it('leaves lapsed REJECTED objects REJECTED and only expires the rest (BE-11)', async () => {
    const repository = new InMemoryStorageRepository();
    const lapsed = new Date(Date.now() - 60 * 1000);
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
    const realCleanup = new StorageCleanupService(
      new StorageService(
        repository,
        new InMemoryObjectStorageService(),
        new StubMalwareScannerService(),
      ),
    );

    await realCleanup.runCleanup();

    expect((await repository.findById('rejected-1'))?.status).toBe('REJECTED');
    expect((await repository.findById('initiated-1'))?.status).toBe('EXPIRED');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('runs from the interval without leaking a rejection', async () => {
    jest.useFakeTimers();
    storageService.cleanupExpired.mockRejectedValue(new Error('boom'));
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    try {
      cleanup.onModuleInit();
      await jest.advanceTimersByTimeAsync(STORAGE_CLEANUP_INTERVAL_MS);
      await Promise.resolve();

      expect(storageService.cleanupExpired).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('Storage cleanup run failed: boom');
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
