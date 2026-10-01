import { FormRepositoryPort } from '../../forms/application/ports/form-repository.port';
import { DemographicProfileRepositoryPort } from '../../users/application/ports/demographic-profile.repository.port';
import { SurveyResponseRepositoryPort } from './ports/survey-response.repository.port';
import { requireCompleteDemographicProfile } from '../../users/application/demographic-profile.gate';
import {
  isSurveyTargetingMatch,
  matchesSurveySearch,
  MarketplaceFeedQueryDto,
  MarketplaceFeedResponseDto,
  MarketplaceSurveyCardDto,
  parseStoredTargeting,
} from '@rescom/schemas';

export class MarketplaceService {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly demographicRepository: DemographicProfileRepositoryPort,
    private readonly responseRepository?: SurveyResponseRepositoryPort,
  ) {}

  async getFeed(
    userId: string,
    query?: MarketplaceFeedQueryDto,
  ): Promise<MarketplaceFeedResponseDto> {
    const hideCompleted = query?.hideCompleted ?? true;
    const sortBy = query?.sortBy ?? 'best_match';
    const typeFilter = query?.type ?? 'ALL';
    const searchFilter = query?.search?.trim();
    const now = new Date();
    const minReward = query?.minReward;
    const maxDuration = query?.maxDuration;

    // 1. Mandatory Demographic Survey gate (Story 7.1, FR-6): the Marketplace
    // is unreachable until the respondent's profile is complete.
    const profileDto = await requireCompleteDemographicProfile(
      this.demographicRepository,
      userId,
    );
    // Kept for contract compatibility; always true once the gate passes.
    const profileCompleted = true;

    // 2. Fetch completed form IDs by this respondent
    const completedFormIds = this.responseRepository
      ? await this.responseRepository.findCompletedFormIdsByRespondent(userId)
      : new Set<string>();

    // 3. Fetch all published forms
    const publishedForms = await this.formRepository.findPublishedForms();
    const allFormIds = publishedForms.map((item) => item.form.id);

    // 4. Fetch completed response counts per form for quota auto-hide
    const completedCounts = this.responseRepository
      ? await this.responseRepository.getCompletedCountsByFormIds(allFormIds)
      : new Map<string, number>();

    // 5. Filter surveys using targeting matching, auto-hide, and query filters
    const matchingCards: MarketplaceSurveyCardDto[] = [];

    for (const item of publishedForms) {
      // Decision E4-DN2 (option A): a Publisher never sees (or takes) their
      // own survey; `ParticipationService.startAttempt` refuses it with 403.
      if (item.form.isOwnedBy(userId)) {
        continue;
      }

      const formId = item.form.id;
      const completedCompletions = completedCounts.get(formId) ?? 0;
      const isCompletedByCurrentUser = completedFormIds.has(formId);

      // Auto-hide when quota is completed (FR-38)
      if (completedCompletions >= item.form.expectedCompletions) {
        continue;
      }

      // Story IR.2b Task 9.2: no new start at or after the deadline.
      if (item.form.isPastDeadline(now)) {
        continue;
      }

      // Auto-hide completed surveys if hideCompleted is true
      if (hideCompleted && isCompletedByCurrentUser) {
        continue;
      }

      // Filter by type
      if (typeFilter !== 'ALL' && item.form.type !== typeFilter) {
        continue;
      }

      // Filter by minReward
      if (minReward != null && item.form.rewardPerResponse < minReward) {
        continue;
      }

      // BE-12: the Publisher's estimated duration wins over the stored
      // `metadata.expectedEffortSeconds`; the same value drives the
      // maxDuration filter, the duration sorts and the card.
      const schema = item.currentVersion.schemaJson;
      const minutes = item.form.estimatedDurationMinutes;
      const durationSeconds =
        typeof minutes === 'number' && minutes > 0 ? minutes * 60 : undefined;
      const estimatedEffort =
        durationSeconds ?? schema?.metadata?.expectedEffortSeconds ?? 60;

      // Filter by maxDuration
      if (maxDuration != null && estimatedEffort > maxDuration) {
        continue;
      }

      // Filter by search keyword: title, description or topic (plan 2.2),
      // ignoring case and Vietnamese diacritics.
      if (
        searchFilter &&
        !matchesSurveySearch(
          {
            title: item.form.title,
            description: item.form.description,
            topic: item.form.topic,
          },
          searchFilter,
        )
      ) {
        continue;
      }

      // Demographic targeting check. Stored targeting is runtime-validated:
      // a malformed row excludes only that survey (fail closed) instead of
      // matching everyone or crashing the whole feed.
      const parsedTargeting = parseStoredTargeting(
        item.currentVersion.targetingJson,
      );
      if (!parsedTargeting.ok) {
        continue;
      }
      const targeting = parsedTargeting.targeting;

      const matches = isSurveyTargetingMatch(targeting, profileDto);
      if (!matches) {
        continue;
      }

      const hasTargeting = Boolean(
        targeting &&
        (targeting.ageRange != null ||
          (targeting.locations && targeting.locations.length > 0) ||
          (targeting.genders && targeting.genders.length > 0) ||
          (targeting.occupations && targeting.occupations.length > 0) ||
          (targeting.fieldOfStudy && targeting.fieldOfStudy.length > 0)),
      );

      matchingCards.push({
        id: item.form.id,
        title: item.form.title,
        description: item.form.description,
        type: item.form.type,
        status: 'PUBLISHED',
        rewardPerResponse: item.form.rewardPerResponse,
        expectedCompletions: item.form.expectedCompletions,
        completedCompletions,
        estimatedEffortSeconds: estimatedEffort,
        versionNumber: item.currentVersion.versionNumber,
        publishedAt: item.currentVersion.publishedAt
          ? item.currentVersion.publishedAt.toISOString()
          : null,
        targetingJson: targeting,
        hasTargeting,
        isCompletedByCurrentUser,
        topic: item.form.topic,
      });
    }

    // 6. Sort matching surveys
    matchingCards.sort((a, b) => {
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;

      switch (sortBy) {
        case 'reward_desc':
          if (b.rewardPerResponse !== a.rewardPerResponse) {
            return b.rewardPerResponse - a.rewardPerResponse;
          }
          return dateB - dateA;

        case 'reward_asc':
          if (a.rewardPerResponse !== b.rewardPerResponse) {
            return a.rewardPerResponse - b.rewardPerResponse;
          }
          return dateB - dateA;

        case 'duration_asc':
          if (a.estimatedEffortSeconds !== b.estimatedEffortSeconds) {
            return a.estimatedEffortSeconds - b.estimatedEffortSeconds;
          }
          return dateB - dateA;

        case 'duration_desc':
          if (b.estimatedEffortSeconds !== a.estimatedEffortSeconds) {
            return b.estimatedEffortSeconds - a.estimatedEffortSeconds;
          }
          return dateB - dateA;

        case 'newest':
          if (dateB !== dateA) {
            return dateB - dateA;
          }
          return b.rewardPerResponse - a.rewardPerResponse;

        case 'best_match':
        default:
          // Targeted matching surveys first, then non-targeted
          if (a.hasTargeting !== b.hasTargeting) {
            return a.hasTargeting ? -1 : 1;
          }
          // Then by highest reward
          if (b.rewardPerResponse !== a.rewardPerResponse) {
            return b.rewardPerResponse - a.rewardPerResponse;
          }
          // Then newest
          return dateB - dateA;
      }
    });

    return {
      surveys: matchingCards,
      total: matchingCards.length,
      profileCompleted,
    };
  }
}
