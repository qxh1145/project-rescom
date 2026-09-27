import { Injectable } from '@nestjs/common';
import { StoredObjectStatus } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  REJECTED_PURGE_BATCH_SIZE,
  STORAGE_CLEANUP_BATCH_SIZE,
  StorageRepositoryPort,
} from '../application/ports/storage-repository.port';
import { StoredObjectEntity } from '../domain/stored-object.entity';

@Injectable()
export class PrismaStorageRepository implements StorageRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(entity: StoredObjectEntity): Promise<void> {
    await this.prisma.storedObject.upsert({
      where: { id: entity.id },
      create: {
        id: entity.id,
        ownerContext: entity.ownerContext,
        ownerRecordId: entity.ownerRecordId,
        questionId: entity.questionId,
        dataClass: entity.dataClass,
        storageKey: entity.storageKey,
        bucket: entity.bucket,
        fileName: entity.fileName,
        fileSize: entity.fileSize,
        mimeType: entity.mimeType,
        checksum: entity.checksum,
        status: entity.status,
        scanStatus: entity.scanStatus,
        scanPolicy: entity.scanPolicy,
        scanResult: entity.scanResult ? (entity.scanResult as any) : undefined,
        uploadedAt: entity.uploadedAt,
        scannedAt: entity.scannedAt,
        attachedAt: entity.attachedAt,
        expiresAt: entity.expiresAt,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      },
      update: this.mutableState(entity),
    });
  }

  async transition(
    id: string,
    expectedStatus: StoredObjectStatus,
    entity: StoredObjectEntity,
  ): Promise<boolean> {
    const result = await this.prisma.storedObject.updateMany({
      where: { id, status: expectedStatus },
      data: this.mutableState(entity),
    });
    return result.count === 1;
  }

  async claimForFinalization(
    id: string,
    entity: StoredObjectEntity,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.storedObject.updateMany({
      where: {
        id,
        storageKey: entity.storageKey,
        OR: [
          { status: 'INITIATED', expiresAt: { gt: now } },
          { status: 'QUARANTINED', scanStatus: 'OUTAGE' },
        ],
      },
      data: this.mutableState(entity),
    });
    return result.count === 1;
  }

  async findById(id: string): Promise<StoredObjectEntity | null> {
    const raw = await this.prisma.storedObject.findUnique({
      where: { id },
    });
    if (!raw) return null;
    return this.toEntity(raw);
  }

  async findByKey(storageKey: string): Promise<StoredObjectEntity | null> {
    const raw = await this.prisma.storedObject.findUnique({
      where: { storageKey },
    });
    if (!raw) return null;
    return this.toEntity(raw);
  }

  async findByOwner(
    ownerContext: string,
    ownerRecordId: string,
  ): Promise<StoredObjectEntity[]> {
    const rows = await this.prisma.storedObject.findMany({
      where: {
        ownerContext,
        ownerRecordId,
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toEntity(r));
  }

  async findExpiredUnattached(
    now: Date,
    limit = STORAGE_CLEANUP_BATCH_SIZE,
  ): Promise<StoredObjectEntity[]> {
    const rows = await this.prisma.storedObject.findMany({
      where: {
        expiresAt: { lte: now },
        status: { notIn: ['ATTACHED', 'DELETED', 'EXPIRED', 'REJECTED'] },
      },
      // Ties broken by id so a batch boundary is stable across runs.
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((row) => this.toEntity(row));
  }

  async findRejectedPendingPurge(
    due: Date,
    limit = REJECTED_PURGE_BATCH_SIZE,
  ): Promise<StoredObjectEntity[]> {
    const rows = await this.prisma.storedObject.findMany({
      where: { status: 'REJECTED', expiresAt: { lte: due } },
      // Ties broken by id so a batch boundary is stable across runs.
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((row) => this.toEntity(row));
  }

  async recordRejectedPurge(
    id: string,
    expectedExpiresAt: Date,
    entity: StoredObjectEntity,
  ): Promise<boolean> {
    const result = await this.prisma.storedObject.updateMany({
      where: { id, status: 'REJECTED', expiresAt: expectedExpiresAt },
      data: this.mutableState(entity),
    });
    return result.count === 1;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.storedObject.delete({
      where: { id },
    });
  }

  private mutableState(entity: StoredObjectEntity) {
    return {
      storageKey: entity.storageKey,
      checksum: entity.checksum,
      status: entity.status,
      scanStatus: entity.scanStatus,
      scanPolicy: entity.scanPolicy,
      scanResult: entity.scanResult ? (entity.scanResult as any) : undefined,
      uploadedAt: entity.uploadedAt,
      scannedAt: entity.scannedAt,
      attachedAt: entity.attachedAt,
      expiresAt: entity.expiresAt,
      updatedAt: entity.updatedAt,
    };
  }

  private toEntity(raw: any): StoredObjectEntity {
    return new StoredObjectEntity(
      raw.id,
      raw.ownerContext,
      raw.ownerRecordId,
      raw.dataClass,
      raw.storageKey,
      raw.bucket,
      raw.fileName,
      raw.fileSize,
      raw.mimeType,
      raw.checksum,
      raw.status,
      raw.scanStatus,
      raw.scanPolicy,
      raw.scanResult as Record<string, unknown> | null,
      raw.uploadedAt,
      raw.scannedAt,
      raw.attachedAt,
      raw.expiresAt,
      raw.createdAt,
      raw.updatedAt,
      raw.questionId,
    );
  }
}
