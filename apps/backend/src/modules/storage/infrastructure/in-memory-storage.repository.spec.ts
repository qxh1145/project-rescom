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
    const now = new Date();
    const open = new Date(now.getTime() + 60 * 1000);

    it('claims INITIATED objects and OUTAGE retries only', async () => {
      await repository.save(entity({ expiresAt: open }));
      await expect(
        repository.claimForFinalization('object-1', entity(), now),
      ).resolves.toBe(true);

      await repository.save(
        entity({ status: 'QUARANTINED', scanStatus: 'PENDING' }),
      );
      await expect(
        repository.claimForFinalization('object-1', entity(), now),
      ).resolves.toBe(false);

      await repository.save(
        entity({ status: 'QUARANTINED', scanStatus: 'OUTAGE' }),
      );
      await expect(
        repository.claimForFinalization('object-1', entity(), now),
      ).resolves.toBe(true);
    });

    it('refuses an INITIATED object whose upload window has closed', async () => {
      for (const expiresAt of [now, new Date(now.getTime() - 1), null]) {
        await repository.save(entity({ expiresAt }));
        await expect(
          repository.claimForFinalization('object-1', entity(), now),
        ).resolves.toBe(false);
        expect((await repository.findById('object-1'))?.status).toBe(
          'INITIATED',
        );
      }
    });

    it('still claims an OUTAGE retry after the upload window', async () => {
      await repository.save(
        entity({
          status: 'QUARANTINED',
          scanStatus: 'OUTAGE',
          expiresAt: new Date(now.getTime() - 1),
        }),
      );
      await expect(
        repository.claimForFinalization('object-1', entity(), now),
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
        repository.claimForFinalization('object-1', entity(), now),
      ).resolves.toBe(false);
      expect((await repository.findById('object-1'))?.storageKey).toBe(
        'verified/participation/attempt-1/object-1',
      );
    });
  });

  describe('REJECTED purge selection', () => {
    const now = new Date();
    const lapsed = new Date(now.getTime() - 1000);
    const rejected = (expiresAt: Date | null) =>
      entity({ status: 'REJECTED', scanStatus: 'INFECTED', expiresAt });

    it('keeps REJECTED objects out of the expiry batch', async () => {
      await repository.save(rejected(lapsed));
      await expect(repository.findExpiredUnattached(now)).resolves.toEqual([]);
    });

    it('selects a lapsed REJECTED object until its expiresAt is cleared', async () => {
      await repository.save(rejected(lapsed));
      await expect(
        repository.findRejectedPendingPurge(now),
      ).resolves.toHaveLength(1);
      await expect(
        repository.findRejectedPendingPurge(new Date(lapsed.getTime() - 1)),
      ).resolves.toEqual([]);

      await repository.save(rejected(null));
      await expect(repository.findRejectedPendingPurge(now)).resolves.toEqual(
        [],
      );
    });

    it('breaks expiresAt ties by id, like the Prisma ordering', async () => {
      for (const id of ['object-c', 'object-a', 'object-b']) {
        await repository.save(Object.assign(rejected(lapsed), { id }));
      }
      const batch = await repository.findRejectedPendingPurge(now, 2);
      expect(batch.map((object) => object.id)).toEqual([
        'object-a',
        'object-b',
      ]);
    });

    it('records a purge outcome only against the selected expiresAt', async () => {
      await repository.save(rejected(lapsed));

      await expect(
        repository.recordRejectedPurge('object-1', lapsed, rejected(null)),
      ).resolves.toBe(true);
      await expect(
        repository.recordRejectedPurge('object-1', lapsed, rejected(null)),
      ).resolves.toBe(false);
    });
  });
});
