import { PrismaService } from '../../../common/database/prisma.service';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import { PrismaFormRepository } from './prisma-form.repository';

describe('PrismaFormRepository', () => {
  const now = new Date('2026-09-15T00:00:00.000Z');
  const schema = {
    schemaVersion: 1,
    title: 'Survey',
    blocks: [],
    settings: {
      shuffleBlocks: false,
      progressBar: true,
      requireAuth: false,
      allowPublicAccess: true,
      submitButtonText: 'Submit',
    },
    metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
  };
  const rawVersion = {
    id: 'version-1',
    formId: 'form-1',
    versionNumber: 1,
    schemaJson: schema,
    targetingJson: null,
    isPublished: false,
    externalUrl: null,
    completionCode: null,
    publishedAt: null,
    createdAt: now,
  };
  const rawForm = {
    id: 'form-1',
    publisherId: 'publisher-1',
    type: 'INTERNAL',
    status: 'DRAFT',
    title: 'Survey',
    description: null,
    rewardPerResponse: 0,
    expectedCompletions: 10,
    createdAt: now,
    updatedAt: now,
    versions: [rawVersion],
  };

  it('uses status and updatedAt in the atomic update predicate', async () => {
    const transaction = {
      form: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(rawForm),
      },
      formVersion: {
        update: jest.fn().mockResolvedValue(rawVersion),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const repository = new PrismaFormRepository(prisma);
    const form = new FormEntity(
      rawForm.id,
      rawForm.publisherId,
      'INTERNAL',
      'DRAFT',
      'Updated',
      null,
      0,
      10,
      now,
      new Date(now.getTime() + 1),
    );
    const version = new FormVersionEntity(
      rawVersion.id,
      rawVersion.formId,
      1,
      schema,
      null,
      false,
      null,
      null,
      null,
      now,
    );

    await repository.update(form, version, {
      status: 'DRAFT',
      updatedAt: now,
    });

    expect(transaction.form.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'form-1', status: 'DRAFT', updatedAt: now },
      }),
    );
  });

  it('returns null without creating a version when the publish-state claim loses', async () => {
    const transaction = {
      form: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      formVersion: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const repository = new PrismaFormRepository(prisma);

    await expect(
      repository.createVersion('form-1', 'version-2', now),
    ).resolves.toBeNull();
    expect(transaction.form.updateMany).toHaveBeenCalledWith({
      where: { id: 'form-1', status: 'PUBLISHED' },
      data: { status: 'DRAFT' },
    });
    expect(transaction.formVersion.create).not.toHaveBeenCalled();
  });

  it('atomically rolls a published form back and creates the next version', async () => {
    const publishedVersion = {
      ...rawVersion,
      isPublished: true,
      publishedAt: now,
    };
    const newVersion = {
      ...rawVersion,
      id: 'version-2',
      versionNumber: 2,
      isPublished: false,
      publishedAt: null,
    };
    const transaction = {
      form: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...rawForm, versions: undefined }),
      },
      formVersion: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([publishedVersion])
          .mockResolvedValueOnce([newVersion, publishedVersion]),
        create: jest.fn().mockResolvedValue(newVersion),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const repository = new PrismaFormRepository(prisma);

    const result = await repository.createVersion('form-1', 'version-2', now);

    expect(transaction.formVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'version-2',
        formId: 'form-1',
        versionNumber: 2,
        isPublished: false,
      }),
    });
    expect(result?.currentVersion.versionNumber).toBe(2);
    expect(result?.form.status).toBe('DRAFT');
  });

  it('propagates transaction failures without returning a partial result', async () => {
    const failure = new Error('transaction rolled back');
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(failure),
    } as unknown as PrismaService;
    const repository = new PrismaFormRepository(prisma);

    await expect(
      repository.createVersion('form-1', 'version-2', now),
    ).rejects.toBe(failure);
  });
});
