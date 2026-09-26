import { DemographicProfileRepositoryPort } from './ports/demographic-profile.repository.port';
import {
  DemographicOnboardingNextStep,
  DemographicProfileStatusDto,
  DemographicSurveySubmissionResultDto,
  REQUIRED_DEMOGRAPHIC_FIELDS,
  SubmitDemographicSurveyInput,
  UpdateDemographicProfileInput,
  submitDemographicSurveySchema,
  updateDemographicProfileSchema,
} from '@rescom/schemas';
import { StarterPointsCoordinator } from '../../economy/application/starter-points.coordinator';
import { DemographicProfileEntity } from '../domain/demographic-profile.entity';

export class DemographicsService {
  constructor(
    private readonly repo: DemographicProfileRepositoryPort,
    private readonly starterPointsCoordinator?: StarterPointsCoordinator,
  ) {}

  async getProfile(userId: string): Promise<DemographicProfileStatusDto> {
    const entity = await this.repo.findByUserId(userId);
    if (!entity) {
      return {
        profile: {
          userId,
          age: null,
          gender: null,
          location: null,
          occupation: null,
          fieldOfStudy: null,
          householdIncome: null,
          specificInterests: null,
        },
        isComplete: false,
        missingFields: [...REQUIRED_DEMOGRAPHIC_FIELDS],
      };
    }

    return this.toStatus(entity);
  }

  /** Partial profile edit (FR-9 "update at any time"). */
  async updateProfile(
    userId: string,
    rawInput: UpdateDemographicProfileInput,
  ): Promise<DemographicProfileStatusDto> {
    const input = updateDemographicProfileSchema.parse(rawInput);
    const updated = await this.repo.upsert(userId, input);
    const status = this.toStatus(updated);

    if (status.isComplete && this.starterPointsCoordinator) {
      await this.starterPointsCoordinator.tryUnlockStarterPoints(
        userId,
        'DEMOGRAPHICS',
      );
    }

    return status;
  }

  /**
   * Mandatory Demographic Survey submission (Story 7.1, FR-6): every field is
   * required. Saves the profile, re-checks the Story 6.5 unlock (points stay
   * Frozen until one Marketplace survey is completed, FR-7/FR-8) and tells the
   * client which onboarding step comes next.
   */
  async submitMandatorySurvey(
    userId: string,
    rawInput: SubmitDemographicSurveyInput,
  ): Promise<DemographicSurveySubmissionResultDto> {
    const input = submitDemographicSurveySchema.parse(rawInput);
    const saved = await this.repo.upsert(userId, input);
    const status = this.toStatus(saved);

    if (status.isComplete && this.starterPointsCoordinator) {
      await this.starterPointsCoordinator.tryUnlockStarterPoints(
        userId,
        'DEMOGRAPHICS',
      );
    }

    return {
      ...status,
      nextStep: await this.resolveNextStep(userId),
    };
  }

  /**
   * The activation step is only useful while the respondent still has to do
   * something to activate (Epic 7 review P4): `SURVEY_REQUIRED` (or, should the
   * save not have registered yet, `DEMOGRAPHICS_REQUIRED`). Every other state
   * skips it — PENDING_CONFIRMATION (an External completion is already under
   * the 48 h review), READY_TO_UNLOCK / ACTIVATED (done), and EXPIRED /
   * NOT_GRANTED (nothing left to activate).
   */
  private async resolveNextStep(
    userId: string,
  ): Promise<DemographicOnboardingNextStep> {
    if (!this.starterPointsCoordinator) {
      return 'MARKETPLACE_ACTIVATION';
    }
    try {
      const starter = await this.starterPointsCoordinator.getStatus(userId);
      return starter.activationState === 'SURVEY_REQUIRED' ||
        starter.activationState === 'DEMOGRAPHICS_REQUIRED'
        ? 'MARKETPLACE_ACTIVATION'
        : 'COMPLETED';
    } catch {
      // Story 7.2: the saved survey must not fail on an Economy read; the
      // activation step shows the live status anyway.
      return 'MARKETPLACE_ACTIVATION';
    }
  }

  private toStatus(
    entity: DemographicProfileEntity,
  ): DemographicProfileStatusDto {
    const missingFields = entity.missingFields();
    return {
      profile: entity.toDto(),
      isComplete: missingFields.length === 0,
      missingFields,
    };
  }
}
