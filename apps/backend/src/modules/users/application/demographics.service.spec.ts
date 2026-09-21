import { DemographicsService } from './demographics.service';
import { InMemoryDemographicProfileRepository } from '../infrastructure/in-memory-demographic-profile.repository';

describe('DemographicsService', () => {
  let service: DemographicsService;
  let repo: InMemoryDemographicProfileRepository;

  const testUserId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    repo = new InMemoryDemographicProfileRepository();
    service = new DemographicsService(repo);
  });

  it('should return an empty uncompleted profile for a new user', async () => {
    const result = await service.getProfile(testUserId);
    expect(result.profile.userId).toBe(testUserId);
    expect(result.profile.age).toBeNull();
    expect(result.profile.gender).toBeNull();
    expect(result.profile.location).toBeNull();
    expect(result.isComplete).toBe(false);
  });

  it('should save and return updated demographic profile', async () => {
    const updated = await service.updateProfile(testUserId, {
      age: 23,
      gender: 'FEMALE',
      location: 'Hanoi',
      occupation: 'Student',
      fieldOfStudy: 'Computer Science',
    });

    expect(updated.profile.age).toBe(23);
    expect(updated.profile.gender).toBe('FEMALE');
    expect(updated.profile.location).toBe('Hanoi');
    expect(updated.profile.occupation).toBe('Student');
    expect(updated.profile.fieldOfStudy).toBe('Computer Science');
    expect(updated.isComplete).toBe(true);

    const fetched = await service.getProfile(testUserId);
    expect(fetched.profile.age).toBe(23);
    expect(fetched.isComplete).toBe(true);
  });

  it('should reject invalid age under 13', async () => {
    await expect(
      service.updateProfile(testUserId, {
        age: 10,
      }),
    ).rejects.toThrow();
  });

  it('should reject invalid gender enum value', async () => {
    await expect(
      service.updateProfile(testUserId, {
        gender: 'UNKNOWN' as any,
      }),
    ).rejects.toThrow();
  });
});
