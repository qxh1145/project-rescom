import { RESERVATION_EXPIRY_MS } from '@rescom/schemas';
import { PrismaStorageOwnerAuthorizationService } from './prisma-storage-owner-authorization.service';
import {
  StorageInvalidFileException,
  StorageUnauthorizedAccessException,
} from '../application/exceptions/storage.exceptions';
import { createStorageCapability } from '../../../common/security/storage-capability';

describe('PrismaStorageOwnerAuthorizationService', () => {
  const capabilitySecret = 'storage-capability-secret-at-least-32-chars';
  const jwtSecret = 'a-different-jwt-secret-at-least-32-characters';
  const attemptId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const otherUserId = '44444444-4444-4444-8444-444444444444';
  const publisherId = '55555555-5555-4555-8555-555555555555';
  const adminId = '66666666-6666-4666-8666-666666666666';
  let prisma: any;
  let service: PrismaStorageOwnerAuthorizationService;

  const freshStart = () => new Date(Date.now() - 60 * 1000);
  const staleStart = () => new Date(Date.now() - RESERVATION_EXPIRY_MS - 1000);

  function attempt(overrides: Record<string, unknown> = {}) {
    return {
      respondentId: userId,
      isGuest: false,
      status: 'IN_PROGRESS',
      startedAt: freshStart(),
      form: { publisherId },
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      surveyAttempt: { findUnique: jest.fn() },
      form: { findUnique: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new PrismaStorageOwnerAuthorizationService(prisma, {
      storageCapabilitySecret: capabilitySecret,
      jwtSecret,
    } as any);
  });

  describe('write access', () => {
    it('authorizes only the respondent who owns a live attempt', async () => {
      prisma.surveyAttempt.findUnique.mockResolvedValue(attempt());
      await expect(
        service.authorize('participation', attemptId, userId, null, 'write'),
      ).resolves.toBeUndefined();
      await expect(
        service.authorize(
          'participation',
          attemptId,
          otherUserId,
          null,
          'write',
        ),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
    });

    it('refuses an IN_PROGRESS attempt past its reservation window', async () => {
      prisma.surveyAttempt.findUnique.mockResolvedValue(
        attempt({ startedAt: staleStart() }),
      );
      await expect(
        service.authorize('participation', attemptId, userId, null, 'write'),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
    });

    it.each(['COMPLETED', 'ABANDONED', 'LOCKED'])(
      'refuses a %s attempt',
      async (status) => {
        prisma.surveyAttempt.findUnique.mockResolvedValue(attempt({ status }));
        await expect(
          service.authorize('participation', attemptId, userId, null, 'write'),
        ).rejects.toThrow(StorageUnauthorizedAccessException);
      },
    );
  });

  describe('read access', () => {
    it('lets the owner read files of a COMPLETED attempt', async () => {
      prisma.surveyAttempt.findUnique.mockResolvedValue(
        attempt({ status: 'COMPLETED', startedAt: staleStart() }),
      );
      await expect(
        service.authorize('participation', attemptId, userId, null, 'read'),
      ).resolves.toBeUndefined();
      await expect(
        service.authorize(
          'participation',
          attemptId,
          otherUserId,
          null,
          'read',
        ),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
    });

    it('still reads an IN_PROGRESS attempt past its reservation window', async () => {
      prisma.surveyAttempt.findUnique.mockResolvedValue(
        attempt({ startedAt: staleStart() }),
      );
      await expect(
        service.authorize('participation', attemptId, userId, null, 'read'),
      ).resolves.toBeUndefined();
    });

    it.each(['ABANDONED', 'LOCKED'])(
      'refuses reads of a %s attempt',
      async (status) => {
        prisma.surveyAttempt.findUnique.mockResolvedValue(attempt({ status }));
        await expect(
          service.authorize('participation', attemptId, userId, null, 'read'),
        ).rejects.toThrow(StorageUnauthorizedAccessException);
      },
    );
  });

  describe('publisher and admin reads (BE-1)', () => {
    function asUser(role: string, status = 'ACTIVE') {
      prisma.user.findUnique.mockResolvedValue({ role, status });
    }

    it('lets the survey publisher read, but not write, respondent files', async () => {
      prisma.surveyAttempt.findUnique.mockResolvedValue(
        attempt({ status: 'COMPLETED', startedAt: staleStart() }),
      );
      await expect(
        service.authorize(
          'participation',
          attemptId,
          publisherId,
          null,
          'read',
        ),
      ).resolves.toBeUndefined();
      expect(prisma.surveyAttempt.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            form: { select: { publisherId: true } },
          }),
        }),
      );

      prisma.surveyAttempt.findUnique.mockResolvedValue(attempt());
      await expect(
        service.authorize(
          'participation',
          attemptId,
          publisherId,
          null,
          'write',
        ),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
    });

    it('lets an active admin read, but not write, respondent files', async () => {
      asUser('ADMIN');
      prisma.surveyAttempt.findUnique.mockResolvedValue(
        attempt({ status: 'COMPLETED' }),
      );
      await expect(
        service.authorize('participation', attemptId, adminId, null, 'read'),
      ).resolves.toBeUndefined();
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: adminId },
        select: { role: true, status: true },
      });

      prisma.surveyAttempt.findUnique.mockResolvedValue(attempt());
      await expect(
        service.authorize('participation', attemptId, adminId, null, 'write'),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
    });

    it.each([
      ['a locked admin', 'ADMIN', 'LOCKED'],
      ['another publisher', 'PUBLISHER', 'ACTIVE'],
      ['another respondent', 'RESPONDENT', 'ACTIVE'],
    ])('refuses reads by %s', async (_label, role, status) => {
      asUser(role, status);
      prisma.surveyAttempt.findUnique.mockResolvedValue(
        attempt({ status: 'COMPLETED' }),
      );
      await expect(
        service.authorize(
          'participation',
          attemptId,
          otherUserId,
          null,
          'read',
        ),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
    });

    it('still refuses the publisher on an ABANDONED attempt', async () => {
      prisma.surveyAttempt.findUnique.mockResolvedValue(
        attempt({ status: 'ABANDONED' }),
      );
      await expect(
        service.authorize(
          'participation',
          attemptId,
          publisherId,
          null,
          'read',
        ),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
    });

    it.each(['forms', 'research'])(
      'lets an active admin read, but not write, %s files',
      async (ownerContext) => {
        asUser('ADMIN');
        prisma.form.findUnique.mockResolvedValue({ publisherId });
        await expect(
          service.authorize(ownerContext, attemptId, adminId, null, 'read'),
        ).resolves.toBeUndefined();
        await expect(
          service.authorize(ownerContext, attemptId, adminId, null, 'write'),
        ).rejects.toThrow(StorageUnauthorizedAccessException);

        asUser('ADMIN', 'LOCKED');
        await expect(
          service.authorize(ownerContext, attemptId, adminId, null, 'read'),
        ).rejects.toThrow(StorageUnauthorizedAccessException);
      },
    );

    it('refuses an admin read of a form that does not exist', async () => {
      asUser('ADMIN');
      prisma.form.findUnique.mockResolvedValue(null);
      await expect(
        service.authorize('forms', attemptId, adminId, null, 'read'),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
    });
  });

  describe('guest capability (P22)', () => {
    beforeEach(() => {
      prisma.surveyAttempt.findUnique.mockResolvedValue(
        attempt({ respondentId: null, isGuest: true }),
      );
    });

    it('accepts a capability minted with the storage capability secret', async () => {
      const capability = createStorageCapability(capabilitySecret, attemptId);
      await expect(
        service.authorize(
          'participation',
          attemptId,
          null,
          capability,
          'write',
        ),
      ).resolves.toBeUndefined();
      await expect(
        service.authorize('participation', attemptId, null, capability, 'read'),
      ).resolves.toBeUndefined();
    });

    it('rejects a capability minted with the JWT secret or missing', async () => {
      await expect(
        service.authorize(
          'participation',
          attemptId,
          null,
          createStorageCapability(jwtSecret, attemptId),
          'write',
        ),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
      await expect(
        service.authorize('participation', attemptId, null, undefined, 'read'),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
    });
  });

  it('keeps forms ownership to the publisher, for reads and writes', async () => {
    prisma.form.findUnique.mockResolvedValue({ publisherId: userId });
    for (const access of ['read', 'write'] as const) {
      await expect(
        service.authorize('forms', attemptId, userId, null, access),
      ).resolves.toBeUndefined();
      await expect(
        service.authorize('forms', attemptId, otherUserId, null, access),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
      await expect(
        service.authorize('forms', attemptId, null, null, access),
      ).rejects.toThrow(StorageUnauthorizedAccessException);
    }
  });

  describe('resolveUploadPolicy', () => {
    const input = {
      fileName: 'report.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      ownerContext: 'participation' as const,
      ownerRecordId: attemptId,
      questionId: 'upload-1',
    };

    it('resolves the immutable file-upload question policy', async () => {
      prisma.surveyAttempt.findUnique
        .mockResolvedValueOnce(attempt())
        .mockResolvedValueOnce({
          version: {
            schemaJson: {
              blocks: [
                {
                  id: 'upload-1',
                  type: 'file_upload',
                  maxFileSizeMb: 5,
                  maxFiles: 2,
                  allowedMimeTypes: ['application/pdf'],
                },
              ],
            },
          },
        });

      const policy = await service.resolveUploadPolicy(input, userId);
      expect(policy).toEqual({
        maxFileSizeBytes: 5 * 1024 * 1024,
        maxFiles: 2,
        allowedMimeTypes: ['application/pdf'],
      });
    });

    it('requires questionId for participation uploads (P4)', async () => {
      await expect(
        service.resolveUploadPolicy(
          { ...input, questionId: undefined },
          userId,
        ),
      ).rejects.toThrow(
        new StorageInvalidFileException('questionId is required'),
      );
      expect(prisma.surveyAttempt.findUnique).not.toHaveBeenCalled();
    });

    it('authorizes the upload as a write', async () => {
      prisma.surveyAttempt.findUnique.mockResolvedValue(
        attempt({ status: 'COMPLETED' }),
      );
      await expect(service.resolveUploadPolicy(input, userId)).rejects.toThrow(
        StorageUnauthorizedAccessException,
      );
    });
  });
});
