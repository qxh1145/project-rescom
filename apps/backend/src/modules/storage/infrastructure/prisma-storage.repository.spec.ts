import { PrismaStorageRepository } from './prisma-storage.repository';
import { StoredObjectEntity } from '../domain/stored-object.entity';

describe('PrismaStorageRepository', () => {
  let prisma: any;
  let repository: PrismaStorageRepository;

  beforeEach(() => {
    prisma = {
      storedObject: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    repository = new PrismaStorageRepository(prisma);
  });

  it('claims INITIATED objects and OUTAGE retries only (BE-3)', async () => {
    const entity = new StoredObjectEntity(
      'object-1',
      'participation',
      'attempt-1',
      'SURVEY_ATTACHMENT',
      'participation/attempt-1/object-1-file.pdf',
      'rescom-private-storage',
      'file.pdf',
      1024,
      'application/pdf',
    );

    const now = new Date();
    await expect(
      repository.claimForFinalization('object-1', entity, now),
    ).resolves.toBe(true);
    expect(prisma.storedObject.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'object-1',
          storageKey: 'participation/attempt-1/object-1-file.pdf',
          OR: [
            { status: 'INITIATED', expiresAt: { gt: now } },
            { status: 'QUARANTINED', scanStatus: 'OUTAGE' },
          ],
        },
      }),
    );

    prisma.storedObject.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.claimForFinalization('object-1', entity, now),
    ).resolves.toBe(false);
  });

  it('keeps REJECTED objects out of the expiry batch', async () => {
    const now = new Date();
    await repository.findExpiredUnattached(now, 10);

    expect(prisma.storedObject.findMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: now },
        status: { notIn: ['ATTACHED', 'DELETED', 'EXPIRED', 'REJECTED'] },
      },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: 10,
    });
  });

  it('selects REJECTED objects pending a purge in their own batch', async () => {
    const due = new Date();
    await repository.findRejectedPendingPurge(due, 5);

    expect(prisma.storedObject.findMany).toHaveBeenCalledWith({
      where: { status: 'REJECTED', expiresAt: { lte: due } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: 5,
    });
  });

  it('records a purge outcome only against the selected expiresAt', async () => {
    const selected = new Date();
    const entity = new StoredObjectEntity(
      'object-1',
      'participation',
      'attempt-1',
      'SURVEY_ATTACHMENT',
      'participation/attempt-1/object-1-file.pdf',
      'rescom-private-storage',
      'file.pdf',
      1024,
      'application/pdf',
      null,
      'REJECTED',
    );

    await expect(
      repository.recordRejectedPurge('object-1', selected, entity),
    ).resolves.toBe(true);
    expect(prisma.storedObject.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'object-1', status: 'REJECTED', expiresAt: selected },
      }),
    );
  });
});
