import { PrismaStarterPointsDataProvider } from './prisma-starter-points-data-provider';
import { PrismaService } from '../../../common/database/prisma.service';

describe('PrismaStarterPointsDataProvider.isDemographicComplete (Story 7.1)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const row = {
    id: '22222222-2222-4222-8222-222222222222',
    userId,
    age: 21,
    location: 'Đà Nẵng',
    householdIncome: 'Dưới 5 triệu VNĐ/tháng',
    specificInterests: {
      gender: 'FEMALE',
      occupation: 'Sinh viên đại học',
      fieldOfStudy: 'Công nghệ thông tin',
      customInterests: ['Trí tuệ nhân tạo (AI)'],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function providerReturning(profile: unknown) {
    const prisma = {
      demographicProfile: {
        findUnique: jest.fn().mockResolvedValue(profile),
      },
    } as unknown as PrismaService;
    return new PrismaStarterPointsDataProvider(prisma);
  }

  it('is true only when every FR-6 field is stored', async () => {
    await expect(
      providerReturning(row).isDemographicComplete(userId),
    ).resolves.toBe(true);
  });

  it('uses the shared rule: age/gender/location alone is no longer complete', async () => {
    await expect(
      providerReturning({
        ...row,
        householdIncome: null,
        specificInterests: { gender: 'FEMALE' },
      }).isDemographicComplete(userId),
    ).resolves.toBe(false);
  });

  it('is false when no profile exists', async () => {
    await expect(
      providerReturning(null).isDemographicComplete(userId),
    ).resolves.toBe(false);
  });
});

describe('PrismaStarterPointsDataProvider.findActivationSurveyCompletions (Story 7.2)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const completedBefore = new Date('2026-10-01T00:00:00.000Z');

  function providerWith(responses: unknown[], attempts: unknown[]) {
    const prisma = {
      response: { findMany: jest.fn().mockResolvedValue(responses) },
      surveyAttempt: { findMany: jest.fn().mockResolvedValue(attempts) },
    };
    return {
      prisma,
      provider: new PrismaStarterPointsDataProvider(
        prisma as unknown as PrismaService,
      ),
    };
  }

  it('queries only eligible completions: validated/completed, non-guest, in window, not the respondent’s own survey, paying at least 1 point (E7-DN2)', async () => {
    const { prisma, provider } = providerWith([], []);

    await provider.findActivationSurveyCompletions(userId, {
      completedBefore,
      limit: 5,
    });

    expect(prisma.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          respondentId: userId,
          isGuest: false,
          status: 'VALIDATED',
          submittedAt: { lte: completedBefore },
          form: {
            publisherId: { not: userId },
            rewardPerResponse: { gte: 1 },
          },
        },
        select: {
          formId: true,
          attemptId: true,
          submittedAt: true,
          form: { select: { rewardPerResponse: true } },
        },
        orderBy: { submittedAt: 'asc' },
        take: 5,
      }),
    );
    expect(prisma.surveyAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          respondentId: userId,
          isGuest: false,
          status: 'COMPLETED',
          submittedAt: { lte: completedBefore },
          form: {
            type: 'EXTERNAL',
            publisherId: { not: userId },
            rewardPerResponse: { gte: 1 },
          },
        },
        select: {
          id: true,
          surveyId: true,
          submittedAt: true,
          form: { select: { rewardPerResponse: true } },
        },
        orderBy: { submittedAt: 'asc' },
        take: 5,
      }),
    );
  });

  it('merges Internal and External completions oldest first, limiting each source separately', async () => {
    const { provider } = providerWith(
      [
        {
          formId: 'form-int-2',
          attemptId: 'att-int-2',
          submittedAt: new Date('2026-09-05T00:00:00.000Z'),
          form: { rewardPerResponse: 10 },
        },
        {
          formId: 'form-int-3',
          attemptId: null,
          submittedAt: new Date('2026-09-07T00:00:00.000Z'),
          form: { rewardPerResponse: 1 },
        },
      ],
      [
        {
          id: 'att-ext-1',
          surveyId: 'form-ext-1',
          submittedAt: new Date('2026-09-03T00:00:00.000Z'),
          form: { rewardPerResponse: 20 },
        },
      ],
    );

    const completions = await provider.findActivationSurveyCompletions(userId, {
      completedBefore,
      limit: 2,
    });

    // Many (possibly reversed) External completions can never crowd out an
    // Internal one: the limit applies per source.
    expect(completions).toEqual([
      {
        source: 'EXTERNAL',
        formId: 'form-ext-1',
        attemptId: 'att-ext-1',
        completedAt: new Date('2026-09-03T00:00:00.000Z'),
        rewardPerResponse: 20,
      },
      {
        source: 'INTERNAL',
        formId: 'form-int-2',
        attemptId: 'att-int-2',
        completedAt: new Date('2026-09-05T00:00:00.000Z'),
        rewardPerResponse: 10,
      },
      {
        source: 'INTERNAL',
        formId: 'form-int-3',
        attemptId: null,
        completedAt: new Date('2026-09-07T00:00:00.000Z'),
        rewardPerResponse: 1,
      },
    ]);
  });
});

describe('PrismaStarterPointsDataProvider.findUsersForExpiry (bounded batches)', () => {
  const cutoffDate = new Date('2026-08-27T00:00:00.000Z');

  function providerWith(accounts: Array<{ userId: string | null }>) {
    const prisma = {
      ledgerAccount: { findMany: jest.fn().mockResolvedValue(accounts) },
    };
    return {
      prisma,
      provider: new PrismaStarterPointsDataProvider(
        prisma as unknown as PrismaService,
      ),
    };
  }

  it('takes one batch of positive Frozen balances ordered by (user.createdAt, userId)', async () => {
    const { prisma, provider } = providerWith([
      { userId: 'user-a' },
      { userId: 'user-b' },
    ]);

    await expect(
      provider.findUsersForExpiry(cutoffDate, { limit: 2, after: null }),
    ).resolves.toEqual(['user-a', 'user-b']);

    expect(prisma.ledgerAccount.findMany).toHaveBeenCalledWith({
      where: {
        accountClass: 'FROZEN',
        balance: { gt: 0 },
        userId: { not: null },
        user: { createdAt: { lte: cutoffDate } },
      },
      orderBy: [{ user: { createdAt: 'asc' } }, { userId: 'asc' }],
      take: 2,
      select: { userId: true },
    });
  });

  it('continues strictly after the cursor position (registeredAt, userId)', async () => {
    const { prisma, provider } = providerWith([]);
    const after = {
      registeredAt: new Date('2026-07-01T08:00:00.000Z'),
      userId: '11111111-1111-4111-8111-111111111111',
    };

    await provider.findUsersForExpiry(cutoffDate, { limit: 100, after });

    expect(prisma.ledgerAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: { createdAt: { lte: cutoffDate } },
          OR: [
            { user: { createdAt: { gt: after.registeredAt } } },
            {
              user: { createdAt: after.registeredAt },
              userId: { gt: after.userId },
            },
          ],
        }),
        take: 100,
      }),
    );
  });
});
