import { DemographicProfileRepositoryPort } from './ports/demographic-profile.repository.port';
import {
  DemographicProfileDto,
  UpdateDemographicProfileInput,
  updateDemographicProfileSchema,
} from '@rescom/schemas';

export class DemographicsService {
  constructor(private readonly repo: DemographicProfileRepositoryPort) {}

  async getProfile(userId: string): Promise<{
    profile: DemographicProfileDto;
    isComplete: boolean;
  }> {
    const entity = await this.repo.findByUserId(userId);
    if (!entity) {
      const emptyDto: DemographicProfileDto = {
        userId,
        age: null,
        gender: null,
        location: null,
        occupation: null,
        fieldOfStudy: null,
        householdIncome: null,
        specificInterests: null,
      };
      return {
        profile: emptyDto,
        isComplete: false,
      };
    }

    return {
      profile: entity.toDto(),
      isComplete: entity.isComplete(),
    };
  }

  async updateProfile(
    userId: string,
    rawInput: UpdateDemographicProfileInput,
  ): Promise<{
    profile: DemographicProfileDto;
    isComplete: boolean;
  }> {
    const input = updateDemographicProfileSchema.parse(rawInput);
    const updated = await this.repo.upsert(userId, input);

    return {
      profile: updated.toDto(),
      isComplete: updated.isComplete(),
    };
  }
}
