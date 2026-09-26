import {
  DemographicProfileDto,
  getMissingDemographicFields,
} from '@rescom/schemas';
import { DemographicProfileRepositoryPort } from './ports/demographic-profile.repository.port';
import { DemographicProfileRequiredException } from './exceptions/demographics.exceptions';

/**
 * Server-side onboarding gate for earning features (Story 7.1, FR-6):
 * returns the respondent's profile when every Mandatory Demographic Survey
 * field is present, otherwise throws `DEMOGRAPHIC_PROFILE_REQUIRED`.
 */
export async function requireCompleteDemographicProfile(
  repository: DemographicProfileRepositoryPort,
  userId: string,
): Promise<DemographicProfileDto> {
  const entity = await repository.findByUserId(userId);
  const profile = entity ? entity.toDto() : null;
  const missingFields = getMissingDemographicFields(profile);

  if (!profile || missingFields.length > 0) {
    throw new DemographicProfileRequiredException(missingFields);
  }

  return profile;
}
