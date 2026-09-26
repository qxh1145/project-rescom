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
  /**
   * Compare-and-set claim of an object for finalization: persists the entity
   * only while it is still INITIATED, or QUARANTINED with a scanner OUTAGE (a
   * retry), and still at the storage key the caller read. Returns `false`
   * when another finalization or writer won the race.
   */
  claimForFinalization(
    id: string,
    entity: StoredObjectEntity,
  ): Promise<boolean>;
  findById(id: string): Promise<StoredObjectEntity | null>;
  findByKey(storageKey: string): Promise<StoredObjectEntity | null>;
  findByOwner(
    ownerContext: string,
    ownerRecordId: string,
  ): Promise<StoredObjectEntity[]>;
  /**
   * Oldest-first batch of unattached objects whose retention has lapsed.
   * DELETED and EXPIRED objects are never selected; a REJECTED object is
   * selected until its bytes are purged (which clears its `expiresAt`).
   */
  findExpiredUnattached(
    now: Date,
    limit?: number,
  ): Promise<StoredObjectEntity[]>;
  delete(id: string): Promise<void>;
}
