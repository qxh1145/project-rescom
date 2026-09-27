import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import {
  MarketplaceController,
  marketplaceFeedQueryPipe,
} from './marketplace.controller';
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

  async function completeProfile() {
    await demoRepo.upsert(mockUser.id, {
      age: 21,
      gender: 'FEMALE',
      location: 'Da Nang',
      occupation: 'Student',
      fieldOfStudy: 'IT',
      householdIncome: 'Under 5M VND',
      specificInterests: ['AI'],
    });
  }

  it('should reject the feed until the mandatory demographic survey is complete (Story 7.1)', async () => {
    await expect(controller.getFeed(mockUser)).rejects.toMatchObject({
      code: 'DEMOGRAPHIC_PROFILE_REQUIRED',
    });
  });

  it('should return marketplace feed inside success envelope', async () => {
    await completeProfile();
    const envelope = await controller.getFeed(mockUser);
    expect(envelope.error).toBeNull();
    expect(envelope.data).toBeDefined();
    expect(envelope.data!.surveys).toEqual([]);
    expect(envelope.data!.total).toBe(0);
  });

  const queryMetadata = { type: 'query' } as ArgumentMetadata;

  it('should pass validated query parameters to service', async () => {
    await completeProfile();
    const spy = jest.spyOn(service, 'getFeed');
    const query = marketplaceFeedQueryPipe.transform(
      {
        sortBy: 'reward_desc',
        hideCompleted: 'false',
        search: 'ai research',
        type: 'INTERNAL',
      },
      queryMetadata,
    );
    await controller.getFeed(mockUser, query);

    expect(spy).toHaveBeenCalledWith(mockUser.id, {
      sortBy: 'reward_desc',
      hideCompleted: false,
      search: 'ai research',
      type: 'INTERNAL',
      minReward: undefined,
      maxDuration: undefined,
    });
  });

  it('binds the feed query to the Zod validation pipe (review P8)', () => {
    const routeArgs = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      MarketplaceController,
      'getFeed',
    ) as Record<string, { pipes?: unknown[] }>;
    const pipes = Object.values(routeArgs).flatMap((arg) => arg.pipes ?? []);
    expect(pipes).toContain(marketplaceFeedQueryPipe);
  });

  it.each([
    { sortBy: 'bogus' },
    { hideCompleted: 'yes' },
    { minReward: 'abc' },
    { minReward: '-1' },
    { search: 'x'.repeat(101) },
    { sortBy: ['reward_desc', 'newest'] },
  ])(
    'rejects invalid query %p with 400 VALIDATION_ERROR instead of a 500',
    (rawQuery) => {
      let error: unknown;
      try {
        marketplaceFeedQueryPipe.transform(rawQuery, queryMetadata);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    },
  );
});
