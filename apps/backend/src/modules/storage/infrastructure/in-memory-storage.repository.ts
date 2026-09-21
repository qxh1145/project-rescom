import { StorageRepositoryPort } from '../application/ports/storage-repository.port';
import { StoredObjectEntity } from '../domain/stored-object.entity';

export class InMemoryStorageRepository implements StorageRepositoryPort {
  private objects = new Map<string, StoredObjectEntity>();

  async save(entity: StoredObjectEntity): Promise<void> {
    this.objects.set(entity.id, entity);
  }

  async claimForScan(
    id: string,
    checksum?: string,
  ): Promise<StoredObjectEntity | null> {
    const entity = this.objects.get(id);
    if (!entity || entity.status !== 'INITIATED') return null;
    entity.markUploaded(checksum);
    entity.markQuarantined();
    this.objects.set(id, entity);
    return entity;
  }

  async findById(id: string): Promise<StoredObjectEntity | null> {
    return this.objects.get(id) ?? null;
  }

  async findByKey(storageKey: string): Promise<StoredObjectEntity | null> {
    for (const obj of this.objects.values()) {
      if (obj.storageKey === storageKey) {
        return obj;
      }
    }
    return null;
  }

  async findByOwner(
    ownerContext: string,
    ownerRecordId: string,
  ): Promise<StoredObjectEntity[]> {
    const list: StoredObjectEntity[] = [];
    for (const obj of this.objects.values()) {
      if (
        obj.ownerContext === ownerContext &&
        obj.ownerRecordId === ownerRecordId
      ) {
        list.push(obj);
      }
    }
    return list.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async findExpiredUnattached(now: Date): Promise<StoredObjectEntity[]> {
    return [...this.objects.values()].filter(
      (object) =>
        object.status !== 'ATTACHED' &&
        object.status !== 'DELETED' &&
        Boolean(object.expiresAt && object.expiresAt <= now),
    );
  }

  async delete(id: string): Promise<void> {
    this.objects.delete(id);
  }

  clear(): void {
    this.objects.clear();
  }
}
