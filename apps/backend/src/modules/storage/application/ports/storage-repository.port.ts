import { StoredObjectStatus } from '@rescom/schemas';
import { StoredObjectEntity } from '../../domain/stored-object.entity';

export const STORAGE_REPOSITORY_PORT = Symbol('STORAGE_REPOSITORY_PORT');

/** Default size of one expiry batch (`findExpiredUnattached`). */
export const STORAGE_CLEANUP_BATCH_SIZE = 200;
/** Default size of one REJECTED purge batch, kept apart from expiry. */
export const REJECTED_PURGE_BATCH_SIZE = 50;

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
   * only while it is still INITIATED with its upload window open at `now`
   * (`expiresAt > now`), or QUARANTINED with a scanner OUTAGE (a retry), and
   * still at the storage key the caller read. Returns `false` when another
   * finalization or writer won the race, or the upload window has closed.
   */
  claimForFinalization(
    id: string,
    entity: StoredObjectEntity,
    now: Date,
  ): Promise<boolean>;
  findById(id: string): Promise<StoredObjectEntity | null>;
  findByKey(storageKey: string): Promise<StoredObjectEntity | null>;
  findByOwner(
    ownerContext: string,
    ownerRecordId: string,
  ): Promise<StoredObjectEntity[]>;
  /**
   * Oldest-first batch of unattached objects whose retention has lapsed.
   * Terminal objects (DELETED, EXPIRED, REJECTED) are never selected.
   */
  findExpiredUnattached(
    now: Date,
    limit?: number,
  ): Promise<StoredObjectEntity[]>;
  /**
   * Oldest-first batch of REJECTED objects whose bytes are not purged yet
   * (`expiresAt` set) and whose `expiresAt` is at or before `due`. Kept apart
   * from expiry so neither batch can starve the other.
   */
  findRejectedPendingPurge(
    due: Date,
    limit?: number,
  ): Promise<StoredObjectEntity[]>;
  /**
   * Compare-and-set for a REJECTED object's purge outcome: writes only while
   * it is still REJECTED with the `expiresAt` the caller selected, so of two
   * concurrent cleanup runs only one records it.
   */
  recordRejectedPurge(
    id: string,
    expectedExpiresAt: Date,
    entity: StoredObjectEntity,
  ): Promise<boolean>;
  delete(id: string): Promise<void>;
}
