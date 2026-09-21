import { StoredObjectEntity } from '../../domain/stored-object.entity';

export const STORAGE_REPOSITORY_PORT = Symbol('STORAGE_REPOSITORY_PORT');

export interface StorageRepositoryPort {
  save(entity: StoredObjectEntity): Promise<void>;
  /** Atomically claims INITIATED metadata and durably advances it to QUARANTINED. */
  claimForScan(id: string, checksum?: string): Promise<StoredObjectEntity | null>;
  findById(id: string): Promise<StoredObjectEntity | null>;
  findByKey(storageKey: string): Promise<StoredObjectEntity | null>;
  findByOwner(
    ownerContext: string,
    ownerRecordId: string,
  ): Promise<StoredObjectEntity[]>;
  findExpiredUnattached(now: Date): Promise<StoredObjectEntity[]>;
  delete(id: string): Promise<void>;
}
