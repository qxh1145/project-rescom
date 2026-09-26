import { SubmitDemographicSurveyInput } from '@rescom/schemas';
import { DemographicProfileRepositoryPort } from '../../src/modules/users/application/ports/demographic-profile.repository.port';

/**
 * A Mandatory Demographic Survey answer set with every FR-6 field (Story 7.1).
 * Earning endpoints (feed, survey attempts) reject users without one.
 */
export const COMPLETE_DEMOGRAPHIC_PROFILE: SubmitDemographicSurveyInput = {
  age: 22,
  gender: 'MALE',
  location: 'Hanoi',
  occupation: 'Student',
  fieldOfStudy: 'Computer Science',
  householdIncome: 'Under 5M VND',
  specificInterests: ['Technology'],
};

export function completeDemographicProfile(
  overrides: Partial<SubmitDemographicSurveyInput> = {},
): SubmitDemographicSurveyInput {
  return { ...COMPLETE_DEMOGRAPHIC_PROFILE, ...overrides };
}

/** Seeds a complete profile so the user passes the onboarding gate. */
export function seedCompleteDemographicProfile(
  repository: DemographicProfileRepositoryPort,
  userId: string,
  overrides: Partial<SubmitDemographicSurveyInput> = {},
) {
  return repository.upsert(userId, completeDemographicProfile(overrides));
}
