import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { StorageRepositoryPort } from '../application/ports/storage-repository.port';
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
      update: {
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
      },
    });
  }

  async claimForScan(
    id: string,
    checksum?: string,
  ): Promise<StoredObjectEntity | null> {
    const now = new Date();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const uploaded = await tx.storedObject.updateMany({
        where: { id, status: 'INITIATED' },
        data: {
          status: 'UPLOADED',
          uploadedAt: now,
          ...(checksum ? { checksum } : {}),
        },
      });
      if (uploaded.count !== 1) return false;
      await tx.storedObject.update({
        where: { id },
        data: { status: 'QUARANTINED', scanStatus: 'PENDING' },
      });
      return true;
    });
    return claimed ? this.findById(id) : null;
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

  async findExpiredUnattached(now: Date): Promise<StoredObjectEntity[]> {
    const rows = await this.prisma.storedObject.findMany({
      where: {
        expiresAt: { lte: now },
        status: { notIn: ['ATTACHED', 'DELETED', 'EXPIRED'] },
      },
    });
    return rows.map((row) => this.toEntity(row));
  }

  async delete(id: string): Promise<void> {
    await this.prisma.storedObject.delete({
      where: { id },
    });
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
