import { StarterActivationState } from '@rescom/schemas';
import { DemographicsService } from './demographics.service';
import { InMemoryDemographicProfileRepository } from '../infrastructure/in-memory-demographic-profile.repository';
import { StarterPointsCoordinator } from '../../economy/application/starter-points.coordinator';

describe('DemographicsService', () => {
  let service: DemographicsService;
  let repo: InMemoryDemographicProfileRepository;

  const testUserId = '11111111-1111-4111-8111-111111111111';
  const completeSurvey = {
    age: 23,
    gender: 'FEMALE' as const,
    location: 'Hanoi',
    occupation: 'Student',
    fieldOfStudy: 'Computer Science',
    householdIncome: 'Under 5M VND',
    specificInterests: ['AI', 'Travel'],
  };

  function starterCoordinator(status: {
    isUnlocked: boolean;
    hasCompletedMarketplaceSurvey: boolean;
    activationState: StarterActivationState;
  }) {
    return {
      tryUnlockStarterPoints: jest.fn().mockResolvedValue({ unlocked: false }),
      getStatus: jest.fn().mockResolvedValue(status),
    } as any;
  }

  beforeEach(() => {
    repo = new InMemoryDemographicProfileRepository();
    service = new DemographicsService(repo);
  });

  it('should return an empty uncompleted profile for a new user with every field missing', async () => {
    const result = await service.getProfile(testUserId);
    expect(result.profile.userId).toBe(testUserId);
    expect(result.profile.age).toBeNull();
    expect(result.profile.gender).toBeNull();
    expect(result.profile.location).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toEqual([
      'age',
      'gender',
      'location',
      'occupation',
      'fieldOfStudy',
      'householdIncome',
      'specificInterests',
    ]);
  });

  it('should save and return updated demographic profile', async () => {
    const updated = await service.updateProfile(testUserId, completeSurvey);

    expect(updated.profile.age).toBe(23);
    expect(updated.profile.gender).toBe('FEMALE');
    expect(updated.profile.location).toBe('Hanoi');
    expect(updated.profile.occupation).toBe('Student');
    expect(updated.profile.fieldOfStudy).toBe('Computer Science');
    expect(updated.isComplete).toBe(true);
    expect(updated.missingFields).toEqual([]);

    const fetched = await service.getProfile(testUserId);
    expect(fetched.profile.age).toBe(23);
    expect(fetched.isComplete).toBe(true);
  });

  it('should report the remaining FR-6 fields after a partial update (Story 7.1)', async () => {
    const updated = await service.updateProfile(testUserId, {
      age: 23,
      gender: 'FEMALE',
      location: 'Hanoi',
    });

    expect(updated.isComplete).toBe(false);
    expect(updated.missingFields).toEqual([
      'occupation',
      'fieldOfStudy',
      'householdIncome',
      'specificInterests',
    ]);
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

  it('should trigger the starter points unlock check when demographic profile is completed', async () => {
    const mockStarterCoordinator = starterCoordinator({
      isUnlocked: false,
      hasCompletedMarketplaceSurvey: false,
      activationState: 'SURVEY_REQUIRED',
    });

    const serviceWithStarter = new DemographicsService(
      repo,
      mockStarterCoordinator,
    );

    await serviceWithStarter.updateProfile(testUserId, completeSurvey);

    expect(mockStarterCoordinator.tryUnlockStarterPoints).toHaveBeenCalledWith(
      testUserId,
      'DEMOGRAPHICS',
    );
  });

  it('should not trigger the unlock check for an incomplete profile', async () => {
    const mockStarterCoordinator = starterCoordinator({
      isUnlocked: false,
      hasCompletedMarketplaceSurvey: false,
      activationState: 'SURVEY_REQUIRED',
    });
    const serviceWithStarter = new DemographicsService(
      repo,
      mockStarterCoordinator,
    );

    await serviceWithStarter.updateProfile(testUserId, {
      age: 25,
      gender: 'MALE',
      location: 'Da Nang',
    });

    expect(
      mockStarterCoordinator.tryUnlockStarterPoints,
    ).not.toHaveBeenCalled();
  });

  describe('submitMandatorySurvey (Story 7.1)', () => {
    it('saves the complete profile and opens the Marketplace activation step', async () => {
      const coordinator = starterCoordinator({
        isUnlocked: false,
        hasCompletedMarketplaceSurvey: false,
        activationState: 'SURVEY_REQUIRED',
      });
      const onboarding = new DemographicsService(repo, coordinator);

      const result = await onboarding.submitMandatorySurvey(
        testUserId,
        completeSurvey,
      );

      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(result.nextStep).toBe('MARKETPLACE_ACTIVATION');
      expect(result.profile.specificInterests).toEqual(['AI', 'Travel']);
      expect(coordinator.tryUnlockStarterPoints).toHaveBeenCalledWith(
        testUserId,
        'DEMOGRAPHICS',
      );
      await expect(onboarding.getProfile(testUserId)).resolves.toMatchObject({
        isComplete: true,
      });
    });

    it.each([
      ['SURVEY_REQUIRED', false, false],
      ['DEMOGRAPHICS_REQUIRED', false, false],
    ] as const)(
      'opens the activation step while the account is %s (Epic 7 review P4)',
      async (activationState, isUnlocked, hasCompletedMarketplaceSurvey) => {
        const onboarding = new DemographicsService(
          repo,
          starterCoordinator({
            isUnlocked,
            hasCompletedMarketplaceSurvey,
            activationState,
          }),
        );

        await expect(
          onboarding.submitMandatorySurvey(testUserId, completeSurvey),
        ).resolves.toMatchObject({ nextStep: 'MARKETPLACE_ACTIVATION' });
      },
    );

    it.each([
      // Survey completed, External still under the 48 h review.
      ['PENDING_CONFIRMATION', false, false],
      ['READY_TO_UNLOCK', false, true],
      ['ACTIVATED', true, true],
      // Nothing left to activate.
      ['EXPIRED', false, false],
      ['NOT_GRANTED', false, false],
    ] as const)(
      'reports COMPLETED when the account is %s (Epic 7 review P4)',
      async (activationState, isUnlocked, hasCompletedMarketplaceSurvey) => {
        const onboarding = new DemographicsService(
          repo,
          starterCoordinator({
            isUnlocked,
            hasCompletedMarketplaceSurvey,
            activationState,
          }),
        );

        await expect(
          onboarding.submitMandatorySurvey(testUserId, completeSurvey),
        ).resolves.toMatchObject({ nextStep: 'COMPLETED' });
      },
    );

    it('falls back to the activation step when the status read throws', async () => {
      const coordinator = {
        tryUnlockStarterPoints: jest
          .fn()
          .mockResolvedValue({ unlocked: false }),
        getStatus: jest.fn().mockRejectedValue(new Error('economy down')),
      } as any;
      const onboarding = new DemographicsService(repo, coordinator);

      const result = await onboarding.submitMandatorySurvey(
        testUserId,
        completeSurvey,
      );

      expect(result.isComplete).toBe(true);
      expect(result.nextStep).toBe('MARKETPLACE_ACTIVATION');
    });

    it('still saves the survey when the starter-points check fails (Story 7.2)', async () => {
      const logger = { warn: jest.fn() };
      const failing = new StarterPointsCoordinator(
        {
          findJournalByIdempotencyKey: jest
            .fn()
            .mockRejectedValue(new Error('ledger down')),
        } as any,
        {
          getUserRegistrationDate: jest
            .fn()
            .mockRejectedValue(new Error('users down')),
        } as any,
        undefined,
        logger,
      );
      const onboarding = new DemographicsService(repo, failing);

      const result = await onboarding.submitMandatorySurvey(
        testUserId,
        completeSurvey,
      );

      expect(result.isComplete).toBe(true);
      expect(result.nextStep).toBe('MARKETPLACE_ACTIVATION');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('DEMOGRAPHICS'),
      );
      await expect(onboarding.getProfile(testUserId)).resolves.toMatchObject({
        isComplete: true,
      });
    });

    it('defaults to the activation step without a starter-points coordinator', async () => {
      const result = await service.submitMandatorySurvey(
        testUserId,
        completeSurvey,
      );
      expect(result.nextStep).toBe('MARKETPLACE_ACTIVATION');
    });

    it('rejects a submission that omits any FR-6 field and saves nothing', async () => {
      const { specificInterests: _omitted, ...withoutInterests } =
        completeSurvey;

      await expect(
        service.submitMandatorySurvey(testUserId, withoutInterests as any),
      ).rejects.toThrow();
      await expect(
        service.submitMandatorySurvey(testUserId, {
          ...completeSurvey,
          occupation: '   ',
        }),
      ).rejects.toThrow();
      await expect(repo.findByUserId(testUserId)).resolves.toBeNull();
    });
  });
});
