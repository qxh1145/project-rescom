import { Test } from '@nestjs/testing';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { DemographicsController } from './demographics.controller';
import { DemographicsService } from '../application/demographics.service';
import { InMemoryDemographicProfileRepository } from '../infrastructure/in-memory-demographic-profile.repository';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';

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

  const completeSurvey = {
    age: 25,
    gender: 'MALE' as const,
    location: 'Ho Chi Minh City',
    occupation: 'Software Engineer',
    fieldOfStudy: 'Information Technology',
    householdIncome: '10 - 20M VND',
    specificInterests: ['Technology'],
  };

  beforeEach(async () => {
    repo = new InMemoryDemographicProfileRepository();
    service = new DemographicsService(repo);

    const moduleRef = await Test.createTestingModule({
      controllers: [DemographicsController],
      providers: [{ provide: DemographicsService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(DemographicsController);
  });

  it('is registered under both the bare and api/ prefixes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, DemographicsController)).toEqual([
      'demographics',
      'api/demographics',
    ]);
  });

  it('should get demographic profile for authenticated user', async () => {
    const envelope = await controller.getProfile(mockUser);
    expect(envelope.error).toBeNull();
    expect(envelope.data!.profile.userId).toBe(mockUser.id);
    expect(envelope.data!.isComplete).toBe(false);
    expect(envelope.data!.missingFields).toHaveLength(7);
  });

  it('should update demographic profile and return success envelope', async () => {
    const envelope = await controller.updateProfile(mockUser, completeSurvey);

    expect(envelope.error).toBeNull();
    expect(envelope.data!.profile.age).toBe(25);
    expect(envelope.data!.profile.gender).toBe('MALE');
    expect(envelope.data!.profile.location).toBe('Ho Chi Minh City');
    expect(envelope.data!.isComplete).toBe(true);
    expect(envelope.data!.missingFields).toEqual([]);
    expect(envelope.meta.message).toBe(
      'Demographic profile updated successfully',
    );
  });

  describe('POST /demographics/survey (Story 7.1)', () => {
    it('is CSRF and JSON-only protected', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        DemographicsController.prototype.submitSurvey,
      );
      expect(guards).toEqual([CsrfGuard, JsonOnlyGuard]);
      expect(
        Reflect.getMetadata(
          PATH_METADATA,
          DemographicsController.prototype.submitSurvey,
        ),
      ).toBe('survey');
    });

    it('returns the completed profile and the activation next step', async () => {
      const envelope = await controller.submitSurvey(mockUser, completeSurvey);

      expect(envelope.error).toBeNull();
      expect(envelope.data).toMatchObject({
        isComplete: true,
        missingFields: [],
        nextStep: 'MARKETPLACE_ACTIVATION',
      });
      expect(envelope.meta.message).toBe(
        'Mandatory demographic survey completed',
      );
    });
  });
});
