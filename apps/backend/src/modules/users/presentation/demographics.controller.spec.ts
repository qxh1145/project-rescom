import { DemographicsController } from './demographics.controller';
import { DemographicsService } from '../application/demographics.service';
import { InMemoryDemographicProfileRepository } from '../infrastructure/in-memory-demographic-profile.repository';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';

describe('DemographicsController', () => {
  let controller: DemographicsController;
  let service: DemographicsService;
  let repo: InMemoryDemographicProfileRepository;

  const mockUser: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'respondent@example.com',
    role: 'RESPONDENT',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    repo = new InMemoryDemographicProfileRepository();
    service = new DemographicsService(repo);
    controller = new DemographicsController(service);
  });

  it('should get demographic profile for authenticated user', async () => {
    const envelope = await controller.getProfile(mockUser);
    expect(envelope.error).toBeNull();
    expect(envelope.data!.profile.userId).toBe(mockUser.id);
    expect(envelope.data!.isComplete).toBe(false);
  });

  it('should update demographic profile and return success envelope', async () => {
    const envelope = await controller.updateProfile(mockUser, {
      age: 25,
      gender: 'MALE',
      location: 'Ho Chi Minh City',
      occupation: 'Software Engineer',
      fieldOfStudy: 'Information Technology',
    });

    expect(envelope.error).toBeNull();
    expect(envelope.data!.profile.age).toBe(25);
    expect(envelope.data!.profile.gender).toBe('MALE');
    expect(envelope.data!.profile.location).toBe('Ho Chi Minh City');
    expect(envelope.data!.isComplete).toBe(true);
    expect(envelope.meta.message).toBe(
      'Demographic profile updated successfully',
    );
  });
});
