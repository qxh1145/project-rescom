import { PrismaStorageOwnerAuthorizationService } from './prisma-storage-owner-authorization.service';
import { StorageUnauthorizedAccessException } from '../application/exceptions/storage.exceptions';
import { createStorageCapability } from '../../../common/security/storage-capability';

describe('PrismaStorageOwnerAuthorizationService', () => {
  const secret = 'test-jwt-secret-at-least-32-characters-long';
  const attemptId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  let prisma: any;
  let service: PrismaStorageOwnerAuthorizationService;

  beforeEach(() => {
    prisma = {
      surveyAttempt: { findUnique: jest.fn() },
      form: { findUnique: jest.fn() },
    };
    service = new PrismaStorageOwnerAuthorizationService(prisma, {
      jwtSecret: secret,
    } as any);
  });

  it('authorizes only the respondent who owns an active attempt', async () => {
    prisma.surveyAttempt.findUnique.mockResolvedValue({
      respondentId: userId,
      isGuest: false,
      status: 'IN_PROGRESS',
    });
    await expect(
      service.authorize('participation', attemptId, userId),
    ).resolves.toBeUndefined();
    await expect(
      service.authorize(
        'participation',
        attemptId,
        '44444444-4444-4444-8444-444444444444',
      ),
    ).rejects.toThrow(StorageUnauthorizedAccessException);
  });

  it('accepts a constant-time owner capability for guest attempts', async () => {
    prisma.surveyAttempt.findUnique.mockResolvedValue({
      respondentId: null,
      isGuest: true,
      status: 'IN_PROGRESS',
    });
    await expect(
      service.authorize(
        'participation',
        attemptId,
        null,
        createStorageCapability(secret, attemptId),
      ),
    ).resolves.toBeUndefined();
  });

  it('resolves the immutable file-upload question policy', async () => {
    prisma.surveyAttempt.findUnique
      .mockResolvedValueOnce({
        respondentId: userId,
        isGuest: false,
        status: 'IN_PROGRESS',
      })
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

    const policy = await service.resolveUploadPolicy(
      {
        fileName: 'report.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        ownerContext: 'participation',
        ownerRecordId: attemptId,
        questionId: 'upload-1',
      },
      userId,
    );
    expect(policy).toEqual({
      maxFileSizeBytes: 5 * 1024 * 1024,
      maxFiles: 2,
      allowedMimeTypes: ['application/pdf'],
    });
  });
});
