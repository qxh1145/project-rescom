import { StoredObjectStatus } from '@rescom/schemas';
import {
  REJECTED_PURGE_BATCH_SIZE,
  STORAGE_CLEANUP_BATCH_SIZE,
  StorageRepositoryPort,
} from '../application/ports/storage-repository.port';
import { StoredObjectEntity } from '../domain/stored-object.entity';

/**
 * Test adapter with row semantics: callers always receive copies, so an
 * entity mutated in memory is not persisted until `save`/`transition` —
 * which keeps the compare-and-set behaviour of `transition` observable.
 */
export class InMemoryStorageRepository implements StorageRepositoryPort {
  private objects = new Map<string, StoredObjectEntity>();

  async save(entity: StoredObjectEntity): Promise<void> {
    this.objects.set(entity.id, copyOf(entity));
  }

  async transition(
    id: string,
    expectedStatus: StoredObjectStatus,
    entity: StoredObjectEntity,
  ): Promise<boolean> {
    const stored = this.objects.get(id);
    if (!stored || stored.status !== expectedStatus) return false;
    this.objects.set(id, copyOf(entity));
    return true;
  }

  async claimForFinalization(
    id: string,
    entity: StoredObjectEntity,
    now: Date,
  ): Promise<boolean> {
    const stored = this.objects.get(id);
    if (
      !stored ||
      stored.storageKey !== entity.storageKey ||
      !(
        (stored.status === 'INITIATED' &&
          Boolean(stored.expiresAt && stored.expiresAt > now)) ||
        (stored.status === 'QUARANTINED' && stored.scanStatus === 'OUTAGE')
      )
    ) {
      return false;
    }
    this.objects.set(id, copyOf(entity));
    return true;
  }

  async findById(id: string): Promise<StoredObjectEntity | null> {
    const stored = this.objects.get(id);
    return stored ? copyOf(stored) : null;
  }

  async findByKey(storageKey: string): Promise<StoredObjectEntity | null> {
    for (const obj of this.objects.values()) {
      if (obj.storageKey === storageKey) {
        return copyOf(obj);
      }
    }
    return null;
  }

  async findByOwner(
    ownerContext: string,
    ownerRecordId: string,
  ): Promise<StoredObjectEntity[]> {
    return [...this.objects.values()]
      .filter(
        (obj) =>
          obj.ownerContext === ownerContext &&
          obj.ownerRecordId === ownerRecordId,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(copyOf);
  }

  async findExpiredUnattached(
    now: Date,
    limit = STORAGE_CLEANUP_BATCH_SIZE,
  ): Promise<StoredObjectEntity[]> {
    return [...this.objects.values()]
      .filter(
        (object) =>
          !['ATTACHED', 'DELETED', 'EXPIRED', 'REJECTED'].includes(
            object.status,
          ) && Boolean(object.expiresAt && object.expiresAt <= now),
      )
      .sort(byExpiryThenId)
      .slice(0, limit)
      .map(copyOf);
  }

  async findRejectedPendingPurge(
    due: Date,
    limit = REJECTED_PURGE_BATCH_SIZE,
  ): Promise<StoredObjectEntity[]> {
    return [...this.objects.values()]
      .filter(
        (object) =>
          object.status === 'REJECTED' &&
          Boolean(object.expiresAt && object.expiresAt <= due),
      )
      .sort(byExpiryThenId)
      .slice(0, limit)
      .map(copyOf);
  }

  async recordRejectedPurge(
    id: string,
    expectedExpiresAt: Date,
    entity: StoredObjectEntity,
  ): Promise<boolean> {
    const stored = this.objects.get(id);
    if (
      !stored ||
      stored.status !== 'REJECTED' ||
      stored.expiresAt?.getTime() !== expectedExpiresAt.getTime()
    ) {
      return false;
    }
    this.objects.set(id, copyOf(entity));
    return true;
  }

  async delete(id: string): Promise<void> {
    this.objects.delete(id);
  }

  clear(): void {
    this.objects.clear();
  }
}

/** Mirrors Prisma's `orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }]`. */
function byExpiryThenId(a: StoredObjectEntity, b: StoredObjectEntity): number {
  return (
    (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

function copyOf(entity: StoredObjectEntity): StoredObjectEntity {
  return Object.assign(
    Object.create(StoredObjectEntity.prototype) as StoredObjectEntity,
    entity,
  );
}
