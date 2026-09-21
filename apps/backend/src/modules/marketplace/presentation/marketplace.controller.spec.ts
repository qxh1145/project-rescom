import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from '../application/marketplace.service';
import { InMemoryFormRepository } from '../../forms/infrastructure/in-memory-form.repository';
import { InMemoryDemographicProfileRepository } from '../../users/infrastructure/in-memory-demographic-profile.repository';
import { InMemorySurveyResponseRepository } from '../infrastructure/in-memory-survey-response.repository';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';

describe('MarketplaceController', () => {
  let controller: MarketplaceController;
  let service: MarketplaceService;
  let formRepo: InMemoryFormRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let responseRepo: InMemorySurveyResponseRepository;

  const mockUser: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'respondent@example.com',
    role: 'RESPONDENT',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    formRepo = new InMemoryFormRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    responseRepo = new InMemorySurveyResponseRepository();
    service = new MarketplaceService(formRepo, demoRepo, responseRepo);
    controller = new MarketplaceController(service);
  });

  it('should return marketplace feed inside success envelope', async () => {
    const envelope = await controller.getFeed(mockUser);
    expect(envelope.error).toBeNull();
    expect(envelope.data).toBeDefined();
    expect(envelope.data!.surveys).toEqual([]);
    expect(envelope.data!.total).toBe(0);
  });

  it('should pass validated query parameters to service', async () => {
    const spy = jest.spyOn(service, 'getFeed');
    await controller.getFeed(mockUser, {
      sortBy: 'reward_desc',
      hideCompleted: 'false',
      search: 'ai research',
      type: 'INTERNAL',
    });

    expect(spy).toHaveBeenCalledWith(mockUser.id, {
      sortBy: 'reward_desc',
      hideCompleted: false,
      search: 'ai research',
      type: 'INTERNAL',
      minReward: undefined,
      maxDuration: undefined,
    });
  });
});
