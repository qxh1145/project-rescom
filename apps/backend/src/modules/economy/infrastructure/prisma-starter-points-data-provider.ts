import { Injectable } from '@nestjs/common';
import { STARTER_ACTIVATION_MIN_SURVEY_REWARD } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  ActivationSurveyCompletionRecord,
  FindActivationCompletionsOptions,
  FindUsersForExpiryOptions,
  StarterPointsUserDataProvider,
} from '../application/starter-points.coordinator';
import { toDemographicProfileEntity } from '../../users/infrastructure/prisma-demographic-profile.repository';

@Injectable()
export class PrismaStarterPointsDataProvider implements StarterPointsUserDataProvider {
  constructor(private readonly prisma: PrismaService) {}

  async getUserRegistrationDate(userId: string): Promise<Date | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    return user?.createdAt ?? null;
  }

  async isDemographicComplete(userId: string): Promise<boolean> {
    const profile = await this.prisma.demographicProfile.findUnique({
      where: { userId },
    });
    if (!profile) return false;
    // Same mapping + completeness rule as the demographics API (Story 7.1).
    return toDemographicProfileEntity(profile).isComplete();
  }

  /**
   * Story 7.2 (FR-7): Marketplace survey completions that may count toward
   * activation — authenticated (non-guest) completions of surveys published by
   * someone else that pay at least 1 point per response (decision E7-DN2,
   * option B(1)). Internal = VALIDATED Response; External = COMPLETED Attempt
   * (verified completion code). Read-only projection of Participation records;
   * Economy never writes them. The demographic survey is a DemographicProfile,
   * not a Form, so it can never appear here.
   */
  async findActivationSurveyCompletions(
    userId: string,
    options: FindActivationCompletionsOptions,
  ): Promise<ActivationSurveyCompletionRecord[]> {
    const [responses, attempts] = await Promise.all([
      this.prisma.response.findMany({
        where: {
          respondentId: userId,
          isGuest: false,
          status: 'VALIDATED',
          submittedAt: { lte: options.completedBefore },
          form: {
            publisherId: { not: userId },
            rewardPerResponse: { gte: STARTER_ACTIVATION_MIN_SURVEY_REWARD },
          },
        },
        select: {
          formId: true,
          attemptId: true,
          submittedAt: true,
          form: { select: { rewardPerResponse: true } },
        },
        orderBy: { submittedAt: 'asc' },
        take: options.limit,
      }),
      this.prisma.surveyAttempt.findMany({
        where: {
          respondentId: userId,
          isGuest: false,
          status: 'COMPLETED',
          submittedAt: { lte: options.completedBefore },
          form: {
            type: 'EXTERNAL',
            publisherId: { not: userId },
            rewardPerResponse: { gte: STARTER_ACTIVATION_MIN_SURVEY_REWARD },
          },
        },
        select: {
          id: true,
          surveyId: true,
          submittedAt: true,
          form: { select: { rewardPerResponse: true } },
        },
        orderBy: { submittedAt: 'asc' },
        take: options.limit,
      }),
    ]);

    const completions: ActivationSurveyCompletionRecord[] = [];
    for (const response of responses) {
      if (response.submittedAt) {
        completions.push({
          source: 'INTERNAL',
          formId: response.formId,
          attemptId: response.attemptId,
          completedAt: response.submittedAt,
          rewardPerResponse: response.form.rewardPerResponse,
        });
      }
    }
    for (const attempt of attempts) {
      if (attempt.submittedAt) {
        completions.push({
          source: 'EXTERNAL',
          formId: attempt.surveyId,
          attemptId: attempt.id,
          completedAt: attempt.submittedAt,
          rewardPerResponse: attempt.form.rewardPerResponse,
        });
      }
    }

    // The limit applies per source, so External completions (which may be
    // disqualified by a reversed credit) never crowd out Internal ones.
    return completions.sort(
      (a, b) => a.completedAt.getTime() - b.completedAt.getTime(),
    );
  }

  /**
   * One bounded batch of expiry candidates (users with a positive Frozen
   * balance), keyset-paginated on (user.createdAt, userId).
   */
  async findUsersForExpiry(
    cutoffDate: Date,
    options: FindUsersForExpiryOptions,
  ): Promise<string[]> {
    const { after } = options;
    const frozenAccounts = await this.prisma.ledgerAccount.findMany({
      where: {
        accountClass: 'FROZEN',
        balance: { gt: 0 },
        userId: { not: null },
        user: {
          createdAt: { lte: cutoffDate },
        },
        ...(after
          ? {
              OR: [
                { user: { createdAt: { gt: after.registeredAt } } },
                {
                  user: { createdAt: after.registeredAt },
                  userId: { gt: after.userId },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ user: { createdAt: 'asc' } }, { userId: 'asc' }],
      take: options.limit,
      select: { userId: true },
    });

    return frozenAccounts
      .map((a) => a.userId)
      .filter((id): id is string => Boolean(id));
  }
}
