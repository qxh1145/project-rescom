import { InMemoryStorageRepository } from './in-memory-storage.repository';
import { StoredObjectEntity } from '../domain/stored-object.entity';

describe('InMemoryStorageRepository', () => {
  const uploadKey = 'participation/attempt-1/object-1-file.pdf';
  let repository: InMemoryStorageRepository;

  function entity(
    overrides: Partial<StoredObjectEntity> = {},
  ): StoredObjectEntity {
    return Object.assign(
      new StoredObjectEntity(
        'object-1',
        'participation',
        'attempt-1',
        'SURVEY_ATTACHMENT',
        uploadKey,
        'rescom-private-storage',
        'file.pdf',
        1024,
        'application/pdf',
      ),
      overrides,
    );
  }

  beforeEach(() => {
    repository = new InMemoryStorageRepository();
  });

  describe('claimForFinalization', () => {
    it('claims INITIATED objects and OUTAGE retries only', async () => {
      await repository.save(entity());
      await expect(
        repository.claimForFinalization('object-1', entity()),
      ).resolves.toBe(true);

      await repository.save(
        entity({ status: 'QUARANTINED', scanStatus: 'PENDING' }),
      );
      await expect(
        repository.claimForFinalization('object-1', entity()),
      ).resolves.toBe(false);

      await repository.save(
        entity({ status: 'QUARANTINED', scanStatus: 'OUTAGE' }),
      );
      await expect(
        repository.claimForFinalization('object-1', entity()),
      ).resolves.toBe(true);
    });

    it('refuses a stale entity whose storage key has since changed', async () => {
      await repository.save(
        entity({
          status: 'QUARANTINED',
          scanStatus: 'OUTAGE',
          storageKey: 'verified/participation/attempt-1/object-1',
        }),
      );

      await expect(
        repository.claimForFinalization('object-1', entity()),
      ).resolves.toBe(false);
      expect((await repository.findById('object-1'))?.storageKey).toBe(
        'verified/participation/attempt-1/object-1',
      );
    });
  });

  it('selects lapsed REJECTED objects until their expiresAt is cleared', async () => {
    const now = new Date();
    const lapsed = new Date(now.getTime() - 1000);
    await repository.save(
      entity({ status: 'REJECTED', scanStatus: 'INFECTED', expiresAt: lapsed }),
    );

    await expect(repository.findExpiredUnattached(now)).resolves.toHaveLength(
      1,
    );

    await repository.save(
      entity({ status: 'REJECTED', scanStatus: 'INFECTED', expiresAt: null }),
    );
    await expect(repository.findExpiredUnattached(now)).resolves.toEqual([]);
  });
});
