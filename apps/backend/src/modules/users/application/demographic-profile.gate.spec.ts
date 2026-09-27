import { requireCompleteDemographicProfile } from './demographic-profile.gate';
import { DemographicProfileRequiredException } from './exceptions/demographics.exceptions';
import { InMemoryDemographicProfileRepository } from '../infrastructure/in-memory-demographic-profile.repository';

describe('requireCompleteDemographicProfile (Story 7.1)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  let repo: InMemoryDemographicProfileRepository;

  beforeEach(() => {
    repo = new InMemoryDemographicProfileRepository();
  });

  it('rejects a user without any profile and lists every missing field', async () => {
    const error = await requireCompleteDemographicProfile(repo, userId).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(DemographicProfileRequiredException);
    const typed = error as DemographicProfileRequiredException;
    expect(typed.code).toBe('DEMOGRAPHIC_PROFILE_REQUIRED');
    expect(typed.missingFields).toEqual([
      'age',
      'gender',
      'location',
      'occupation',
      'fieldOfStudy',
      'householdIncome',
      'specificInterests',
    ]);
  });

  it('rejects a partially completed profile with the remaining fields', async () => {
    await repo.upsert(userId, { age: 22, gender: 'MALE', location: 'Hanoi' });

    await expect(
      requireCompleteDemographicProfile(repo, userId),
    ).rejects.toMatchObject({
      code: 'DEMOGRAPHIC_PROFILE_REQUIRED',
      missingFields: [
        'occupation',
        'fieldOfStudy',
        'householdIncome',
        'specificInterests',
      ],
    });
  });

  it('returns the profile DTO when every FR-6 field is present', async () => {
    await repo.upsert(userId, {
      age: 22,
      gender: 'MALE',
      location: 'Hanoi',
      occupation: 'Student',
      fieldOfStudy: 'Computer Science',
      householdIncome: 'Under 5M VND',
      specificInterests: ['AI'],
    });

    const profile = await requireCompleteDemographicProfile(repo, userId);

    expect(profile.userId).toBe(userId);
    expect(profile.location).toBe('Hanoi');
  });
});
