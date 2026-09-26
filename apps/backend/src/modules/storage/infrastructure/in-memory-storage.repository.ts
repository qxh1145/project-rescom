import { StoredObjectStatus } from '@rescom/schemas';
import { StorageRepositoryPort } from '../application/ports/storage-repository.port';
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
  ): Promise<boolean> {
    const stored = this.objects.get(id);
    if (
      !stored ||
      !(
        stored.status === 'INITIATED' ||
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
    limit = 200,
  ): Promise<StoredObjectEntity[]> {
    return [...this.objects.values()]
      .filter(
        (object) =>
          !['ATTACHED', 'DELETED', 'EXPIRED', 'REJECTED'].includes(
            object.status,
          ) && Boolean(object.expiresAt && object.expiresAt <= now),
      )
      .sort(
        (a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0),
      )
      .slice(0, limit)
      .map(copyOf);
  }

  async delete(id: string): Promise<void> {
    this.objects.delete(id);
  }

  clear(): void {
    this.objects.clear();
  }
}

function copyOf(entity: StoredObjectEntity): StoredObjectEntity {
  return Object.assign(
    Object.create(StoredObjectEntity.prototype) as StoredObjectEntity,
    entity,
  );
}
