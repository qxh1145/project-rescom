import { StoredObjectStatus } from '@rescom/schemas';
import { StoredObjectEntity } from '../../domain/stored-object.entity';

export const STORAGE_REPOSITORY_PORT = Symbol('STORAGE_REPOSITORY_PORT');

export interface StorageRepositoryPort {
  /** Inserts a new object (or unconditionally overwrites it). */
  save(entity: StoredObjectEntity): Promise<void>;
  /**
   * Compare-and-set persistence of a state transition (Epic 5 review P18):
   * writes the entity's mutable state only while the stored status still
   * equals `expectedStatus`. Returns `false` when another writer won the race.
   */
  transition(
    id: string,
    expectedStatus: StoredObjectStatus,
    entity: StoredObjectEntity,
  ): Promise<boolean>;
  findById(id: string): Promise<StoredObjectEntity | null>;
  findByKey(storageKey: string): Promise<StoredObjectEntity | null>;
  findByOwner(
    ownerContext: string,
    ownerRecordId: string,
  ): Promise<StoredObjectEntity[]>;
  /** Oldest-first batch of unattached objects whose retention has lapsed. */
  findExpiredUnattached(
    now: Date,
    limit?: number,
  ): Promise<StoredObjectEntity[]>;
  delete(id: string): Promise<void>;
}
