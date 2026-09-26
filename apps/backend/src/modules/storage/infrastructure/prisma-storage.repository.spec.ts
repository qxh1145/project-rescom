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

    await expect(
      repository.claimForFinalization('object-1', entity),
    ).resolves.toBe(true);
    expect(prisma.storedObject.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'object-1',
          OR: [
            { status: 'INITIATED' },
            { status: 'QUARANTINED', scanStatus: 'OUTAGE' },
          ],
        },
      }),
    );

    prisma.storedObject.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.claimForFinalization('object-1', entity),
    ).resolves.toBe(false);
  });

  it('never selects REJECTED objects for expiry (BE-11)', async () => {
    const now = new Date();
    await repository.findExpiredUnattached(now, 10);

    expect(prisma.storedObject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          expiresAt: { lte: now },
          status: { notIn: ['ATTACHED', 'DELETED', 'EXPIRED', 'REJECTED'] },
        },
        take: 10,
      }),
    );
  });
});
