import { PrismaService } from '../../../common/database/prisma.service';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import { PrismaFormRepository } from './prisma-form.repository';
import { PrismaUnitOfWork } from '../../../common/database/prisma-unit-of-work';

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

  it('persists and maps the estimated duration (decision E6-D2)', async () => {
    const transaction = {
      form: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...rawForm, estimatedDurationMinutes: 12 }),
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
      'Survey',
      null,
      20,
      10,
      now,
      new Date(now.getTime() + 1),
      undefined,
      0,
      12,
    );

    const saved = await repository.update(form, undefined, {
      status: 'DRAFT',
      updatedAt: now,
    });

    expect(transaction.form.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estimatedDurationMinutes: 12 }),
      }),
    );
    expect(saved?.form.estimatedDurationMinutes).toBe(12);
  });

  it('persists the close kind with the CLOSED transition and maps it back (decision E8-D1)', async () => {
    const transaction = {
      form: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          ...rawForm,
          status: 'CLOSED',
          closeCount: 1,
          closeKind: 'ADMIN',
        }),
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
    const live = new FormEntity(
      rawForm.id,
      rawForm.publisherId,
      'INTERNAL',
      'PUBLISHED',
      'Survey',
      null,
      0,
      10,
      now,
      now,
    );

    const saved = await repository.update(
      live.close('ADMIN', new Date(now.getTime() + 1)),
      undefined,
      { status: 'PUBLISHED', updatedAt: now },
    );

    expect(transaction.form.updateMany).toHaveBeenCalledWith({
      where: { id: rawForm.id, status: 'PUBLISHED', updatedAt: now },
      data: expect.objectContaining({
        status: 'CLOSED',
        closeCount: 1,
        closeKind: 'ADMIN',
      }),
    });
    expect(saved?.form.closeKind).toBe('ADMIN');
    expect(saved?.form.isReopenableByOwner()).toBe(false);
  });

  it('maps a row without a close kind to null', async () => {
    const prisma = {
      form: {
        findUnique: jest.fn().mockResolvedValue(rawForm),
      },
    } as unknown as PrismaService;

    const found = await new PrismaFormRepository(prisma).findById(rawForm.id);

    expect(found?.form.closeKind).toBeNull();
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

  it('persists the completion-code verifier in update() (review P2)', async () => {
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
      'EXTERNAL',
      'MODERATION_QUEUE',
      'Survey',
      null,
      10,
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
      'https://forms.gle/abc',
      'v1:verifier',
      null,
      now,
    );

    await repository.update(form, version, { status: 'DRAFT' });

    expect(transaction.formVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: expect.objectContaining({ completionCode: 'v1:verifier' }),
    });
  });

  describe('createVersion (review P4/P5)', () => {
    function buildTransaction(
      versions: Array<Record<string, unknown>>,
      updateCount = 1,
    ) {
      return {
        form: {
          updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...rawForm, versions: undefined }),
        },
        formVersion: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce(versions)
            .mockResolvedValueOnce(versions),
          create: jest.fn().mockResolvedValue(versions[0]),
        },
      };
    }
    function repositoryFor(transaction: ReturnType<typeof buildTransaction>) {
      const prisma = {
        $transaction: jest.fn(
          async (callback: (tx: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
      } as unknown as PrismaService;
      return new PrismaFormRepository(prisma);
    }

    it('clones the newest version (with pending edits), not the last published one', async () => {
      const editedSchema = { ...schema, title: 'Edited draft title' };
      const v2Draft = {
        ...rawVersion,
        id: 'version-2',
        versionNumber: 2,
        schemaJson: editedSchema,
        targetingJson: { locations: ['Hà Nội'] },
        externalUrl: 'https://forms.gle/edited',
      };
      const v1Published = {
        ...rawVersion,
        isPublished: true,
        publishedAt: now,
        externalUrl: 'https://forms.gle/original',
      };
      const transaction = buildTransaction([v2Draft, v1Published]);

      await repositoryFor(transaction).createVersion(
        'form-1',
        'version-3',
        now,
        { completionCode: 'v1:new', expectedStatus: 'DRAFT' },
      );

      expect(transaction.formVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'version-3',
          versionNumber: 3,
          schemaJson: editedSchema,
          targetingJson: { locations: ['Hà Nội'] },
          externalUrl: 'https://forms.gle/edited',
          completionCode: 'v1:new',
        }),
      });
    });

    it('keeps the status under an expectedStatus precondition and returns null when it lost a race', async () => {
      const transaction = buildTransaction([rawVersion], 0);

      await expect(
        repositoryFor(transaction).createVersion('form-1', 'version-2', now, {
          completionCode: 'v1:new',
          isPublished: true,
          expectedStatus: 'PUBLISHED',
        }),
      ).resolves.toBeNull();

      expect(transaction.form.updateMany).toHaveBeenCalledWith({
        where: { id: 'form-1', status: 'PUBLISHED' },
        data: { updatedAt: now },
      });
      expect(transaction.formVersion.create).not.toHaveBeenCalled();
    });
  });

  it('loads only the newest published version per PUBLISHED form and skips forms without one (review P11)', async () => {
    const publishedV1 = { ...rawVersion, isPublished: true, publishedAt: now };
    const findMany = jest.fn().mockResolvedValue([
      { ...rawForm, status: 'PUBLISHED', versions: [publishedV1] },
      { ...rawForm, id: 'form-2', status: 'PUBLISHED', versions: [] },
    ]);
    const prisma = { form: { findMany } } as unknown as PrismaService;
    const repository = new PrismaFormRepository(prisma);

    const result = await repository.findPublishedForms();

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'PUBLISHED' },
      orderBy: { updatedAt: 'desc' },
      include: {
        versions: {
          where: { isPublished: true },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0].form.id).toBe('form-1');
    expect(result[0].currentVersion.id).toBe('version-1');
    expect(result[0].versions).toHaveLength(1);
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

  describe('Story 8.1', () => {
    it('joins the ambient Unit of Work instead of opening a second transaction', async () => {
      const transaction = {
        form: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({
            ...rawForm,
            status: 'PUBLISHED',
          }),
        },
        formVersion: { update: jest.fn().mockResolvedValue(rawVersion) },
      };
      const $transaction = jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      );
      const prisma = { $transaction } as unknown as PrismaService;
      const repository = new PrismaFormRepository(prisma);
      const unitOfWork = new PrismaUnitOfWork(prisma);
      const form = new FormEntity(
        rawForm.id,
        rawForm.publisherId,
        'INTERNAL',
        'PUBLISHED',
        'Survey',
        null,
        0,
        10,
        now,
        new Date(now.getTime() + 1),
      );

      const result = await unitOfWork.run('moderation:version-1', () =>
        repository.update(form, undefined, {
          status: 'MODERATION_QUEUE',
          updatedAt: now,
        }),
      );

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(transaction.form.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'form-1', status: 'MODERATION_QUEUE', updatedAt: now },
        }),
      );
      expect(result?.form.status).toBe('PUBLISHED');
    });

    it('lists the moderation queue oldest-first with the pinned version', async () => {
      const queued = {
        ...rawForm,
        status: 'MODERATION_QUEUE',
        versions: [
          { ...rawVersion, id: 'version-2', versionNumber: 2 },
          { ...rawVersion, isPublished: true, publishedAt: now },
        ],
      };
      const findMany = jest.fn().mockResolvedValue([queued]);
      const count = jest.fn().mockResolvedValue(3);
      const prisma = {
        form: { findMany, count },
      } as unknown as PrismaService;
      const repository = new PrismaFormRepository(prisma);

      const page = await repository.findModerationQueue({
        limit: 1,
        offset: 2,
      });

      expect(findMany).toHaveBeenCalledWith({
        where: { status: 'MODERATION_QUEUE' },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        skip: 2,
        take: 1,
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
      });
      expect(count).toHaveBeenCalledWith({
        where: { status: 'MODERATION_QUEUE' },
      });
      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(1);
      expect(page.items[0].currentVersion.id).toBe('version-2');
      expect(page.items[0].versions).toHaveLength(2);
    });
  });
});
