import { PrismaUserProfileRepository } from './prisma-user-profile.repository';
import { PrismaService } from '../../../common/database/prisma.service';

describe('PrismaUserProfileRepository', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const stored = {
    userId,
    displayName: 'Linh',
    birthYear: 2005,
    school: 'ĐH FPT',
    schoolYear: 'Năm 3',
    goal: 'BOTH' as const,
    createdAt: new Date('2026-09-26T10:00:00.000Z'),
    updatedAt: new Date('2026-09-26T10:00:00.000Z'),
  };

  function repositoryWith(rows: Array<typeof stored> = []) {
    const userProfile = {
      findUnique: jest.fn(async () => rows[0] ?? null),
      upsert: jest.fn(async (args: any) => ({
        ...stored,
        ...args.update,
      })),
      findMany: jest.fn(async () =>
        rows.map(({ userId: id, displayName }) => ({
          userId: id,
          displayName,
        })),
      ),
    };
    const $transaction = jest.fn();
    const prisma = { userProfile, $transaction } as unknown as PrismaService;
    return {
      repo: new PrismaUserProfileRepository(prisma),
      userProfile,
      $transaction,
    };
  }

  it('reads one row by user id', async () => {
    const { repo, userProfile } = repositoryWith([stored]);

    await expect(repo.findByUserId(userId)).resolves.toEqual(stored);
    expect(userProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId } }),
    );
  });

  it('upserts in one statement and updates only the keys present in the patch', async () => {
    const { repo, userProfile, $transaction } = repositoryWith();

    await repo.upsertPartial(userId, { goal: 'COLLECT', school: null });

    expect($transaction).not.toHaveBeenCalled();
    expect(userProfile.upsert).toHaveBeenCalledTimes(1);
    const args = userProfile.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId });
    expect(args.create).toEqual({ userId, goal: 'COLLECT', school: null });
    // Absent keys keep the stored value; an explicit null clears it.
    expect(args.update).toEqual({ goal: 'COLLECT', school: null });
    expect(args.select).toMatchObject({
      userId: true,
      displayName: true,
      birthYear: true,
      school: true,
      schoolYear: true,
      goal: true,
      updatedAt: true,
    });
  });

  it('writes every field of a full patch', async () => {
    const { repo, userProfile } = repositoryWith();
    const patch = {
      displayName: 'Linh',
      birthYear: 2005,
      school: 'ĐH FPT',
      schoolYear: 'Năm 3' as const,
      goal: 'BOTH' as const,
    };

    const saved = await repo.upsertPartial(userId, patch);

    expect(userProfile.upsert.mock.calls[0][0].update).toEqual(patch);
    expect(userProfile.upsert.mock.calls[0][0].create).toEqual({
      userId,
      ...patch,
    });
    expect(saved).toMatchObject(patch);
  });

  it('labels each requested user with its display name, null when it has none', async () => {
    const { repo, userProfile } = repositoryWith([stored]);

    const labels = await repo.findDisplayLabels([userId, otherUserId, userId]);

    expect([...labels.entries()]).toEqual([
      [userId, 'Linh'],
      [otherUserId, null],
    ]);
    expect(userProfile.findMany).toHaveBeenCalledWith({
      where: { userId: { in: [userId, otherUserId] } },
      select: { userId: true, displayName: true },
    });
  });

  it('does not query for an empty id list', async () => {
    const { repo, userProfile } = repositoryWith([stored]);

    await expect(repo.findDisplayLabels([])).resolves.toEqual(new Map());
    expect(userProfile.findMany).not.toHaveBeenCalled();
  });
});
