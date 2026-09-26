import { isStarterActivationRewardEligible } from '@rescom/schemas';
import {
  ActivationSurveyCompletionRecord,
  FindActivationCompletionsOptions,
  FindUsersForExpiryOptions,
  StarterPointsUserDataProvider,
} from '../application/starter-points.coordinator';

export class InMemoryStarterPointsDataProvider implements StarterPointsUserDataProvider {
  public readonly userRegistrationDates = new Map<string, Date>();
  public readonly demographicCompletions = new Map<string, boolean>();
  /** Eligible Marketplace survey completions per user (Story 7.2). */
  public readonly completions = new Map<
    string,
    ActivationSurveyCompletionRecord[]
  >();

  async getUserRegistrationDate(userId: string): Promise<Date | null> {
    return this.userRegistrationDates.get(userId) ?? new Date();
  }

  async isDemographicComplete(userId: string): Promise<boolean> {
    return this.demographicCompletions.get(userId) ?? false;
  }

  async findActivationSurveyCompletions(
    userId: string,
    options: FindActivationCompletionsOptions,
  ): Promise<ActivationSurveyCompletionRecord[]> {
    const inWindow = (this.completions.get(userId) ?? [])
      .filter(
        (completion) =>
          completion.completedAt.getTime() <=
            options.completedBefore.getTime() &&
          // Same filter as the Prisma query (decision E7-DN2, option B(1)).
          isStarterActivationRewardEligible(completion.rewardPerResponse),
      )
      .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
    // Same contract as the Prisma adapter: the limit applies per source.
    return [
      ...inWindow
        .filter((c) => c.source === 'INTERNAL')
        .slice(0, options.limit),
      ...inWindow
        .filter((c) => c.source === 'EXTERNAL')
        .slice(0, options.limit),
    ].sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  }

  /** Test helper: records one completion (defaults: Internal, now, 10-point survey). */
  recordCompletion(
    userId: string,
    completion: Partial<ActivationSurveyCompletionRecord> = {},
  ): ActivationSurveyCompletionRecord {
    const record: ActivationSurveyCompletionRecord = {
      source: completion.source ?? 'INTERNAL',
      formId: completion.formId ?? `form-${userId}`,
      attemptId: completion.attemptId ?? null,
      completedAt: completion.completedAt ?? new Date(),
      rewardPerResponse: completion.rewardPerResponse ?? 10,
    };
    this.completions.set(userId, [
      ...(this.completions.get(userId) ?? []),
      record,
    ]);
    return record;
  }

  /** Same order and keyset contract as the Prisma adapter: (registeredAt, userId). */
  async findUsersForExpiry(
    cutoffDate: Date,
    options: FindUsersForExpiryOptions,
  ): Promise<string[]> {
    const { after } = options;
    return [...this.userRegistrationDates.entries()]
      .map(([userId, registeredAt]) => ({ userId, at: registeredAt.getTime() }))
      .filter(({ at }) => at <= cutoffDate.getTime())
      .filter(
        ({ userId, at }) =>
          !after ||
          at > after.registeredAt.getTime() ||
          (at === after.registeredAt.getTime() && userId > after.userId),
      )
      .sort((a, b) => a.at - b.at || (a.userId < b.userId ? -1 : 1))
      .slice(0, options.limit)
      .map(({ userId }) => userId);
  }

  clear(): void {
    this.userRegistrationDates.clear();
    this.demographicCompletions.clear();
    this.completions.clear();
  }
}
