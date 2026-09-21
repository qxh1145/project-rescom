import { ParticipationService, RESERVATION_EXPIRY_MINUTES } from './participation.service';
import {
  ParticipationRepositoryPort,
  QuotaStatus,
  CreateAttemptWithResponseParams,
} from './ports/participation-repository.port';
import { FormRepositoryPort, FormWithVersion } from '../../forms/application/ports/form-repository.port';
import { DemographicProfileRepositoryPort } from '../../users/application/ports/demographic-profile.repository.port';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import { DemographicProfileEntity } from '../../users/domain/demographic-profile.entity';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';
import { ResponseEntity } from '../domain/response.entity';
import {
  ParticipantNotEligibleException,
  SurveyAlreadyCompletedException,
  SurveyQuotaFullException,
  ConflictingActiveAttemptException,
  SurveyNotAvailableException,
} from './exceptions/participation.exceptions';

describe('ParticipationService', () => {
  let service: ParticipationService;
  let mockFormRepo: jest.Mocked<FormRepositoryPort>;
  let mockDemographicRepo: jest.Mocked<DemographicProfileRepositoryPort>;
  let mockParticipationRepo: jest.Mocked<ParticipationRepositoryPort>;

  const userId = 'user-1111-1111-1111-111111111111';
  const formId = 'form-2222-2222-2222-222222222222';
  const formVersionId = 'ver-3333-3333-3333-333333333333';
  const clientIp = '127.0.0.1';

  function createMockFormWithVersion(
    overrides?: {
      status?: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ESCROW_LOCKED' | 'MODERATION_QUEUE';
      type?: 'INTERNAL' | 'EXTERNAL';
      expectedCompletions?: number;
      targetingJson?: Record<string, unknown> | null;
      externalUrl?: string | null;
    },
  ): FormWithVersion {
    const form = new FormEntity(
      formId,
      'publisher-id',
      overrides?.type ?? 'INTERNAL',
      overrides?.status ?? 'PUBLISHED',
      'Test Survey',
      'Description',
      50,
      overrides?.expectedCompletions ?? 10,
      new Date(),
      new Date(),
    );

    const currentVersion = new FormVersionEntity(
      formVersionId,
      formId,
      1,
      { title: 'Schema', blocks: [] } as any,
      (overrides?.targetingJson as any) ?? null,
      true,
      overrides?.externalUrl ?? null,
      null,
      new Date(),
      new Date(),
    );

    return { form, currentVersion };
  }

  beforeEach(() => {
    mockFormRepo = {
      findById: jest.fn(),
      create: jest.fn(),
      findManyByPublisher: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createVersion: jest.fn(),
      findAllVersions: jest.fn(),
      findPublishedForms: jest.fn(),
    };

    mockDemographicRepo = {
      findByUserId: jest.fn(),
      upsert: jest.fn(),
    };

    mockParticipationRepo = {
      hasCompletedLogicalForm: jest.fn().mockResolvedValue(false),
      findConflictingActiveAttempt: jest.fn().mockResolvedValue(null),
      abandonExpiredAttempts: jest.fn().mockResolvedValue(0),
      getQuotaStatus: jest.fn().mockResolvedValue({ completedCount: 0, activeReservationCount: 0 }),
      createAttemptWithResponse: jest.fn(),
      findAttemptById: jest.fn(),
      findResponseById: jest.fn(),
      saveIntegrityEvents: jest.fn().mockResolvedValue(0),
    };

    service = new ParticipationService(
      mockFormRepo,
      mockDemographicRepo,
      mockParticipationRepo,
    );
  });

  describe('startAttempt', () => {
    it('should successfully start an INTERNAL attempt and create durable Response identity in the same transaction', async () => {
      const formWithVersion = createMockFormWithVersion({ type: 'INTERNAL' });
      mockFormRepo.findById.mockResolvedValue(formWithVersion);
      mockDemographicRepo.findByUserId.mockResolvedValue(null); // open targeting

      const mockAttempt = new SurveyAttemptEntity(
        'attempt-uuid-1',
        formId,
        formVersionId,
        userId,
        'IN_PROGRESS',
        false,
        new Date(),
        null,
        null,
        new Date(),
        new Date(),
      );

      const mockResponse = new ResponseEntity(
        'response-uuid-1',
        formId,
        formVersionId,
        'attempt-uuid-1',
        userId,
        'IN_PROGRESS',
        null,
        clientIp,
        false,
        null,
        new Date(),
        new Date(),
      );

      mockParticipationRepo.createAttemptWithResponse.mockResolvedValue({
        attempt: mockAttempt,
        response: mockResponse,
      });

      const result = await service.startAttempt(formId, userId, {}, clientIp);

      expect(result.attemptId).toBe('attempt-uuid-1');
      expect(result.responseId).toBe('response-uuid-1');
      expect(result.formId).toBe(formId);
      expect(result.formVersionId).toBe(formVersionId);
      expect(result.type).toBe('INTERNAL');
      expect(result.status).toBe('IN_PROGRESS');
      expect(result.externalUrl).toBeNull();
      expect(mockParticipationRepo.createAttemptWithResponse).toHaveBeenCalledTimes(1);
    });

    it('should successfully start an EXTERNAL attempt with null responseId and return externalUrl', async () => {
      const extUrl = 'https://docs.google.com/forms/d/e/sample/viewform';
      const formWithVersion = createMockFormWithVersion({
        type: 'EXTERNAL',
        externalUrl: extUrl,
      });
      mockFormRepo.findById.mockResolvedValue(formWithVersion);

      const mockAttempt = new SurveyAttemptEntity(
        'attempt-uuid-2',
        formId,
        formVersionId,
        userId,
        'IN_PROGRESS',
        false,
        new Date(),
        null,
        null,
        new Date(),
        new Date(),
      );

      mockParticipationRepo.createAttemptWithResponse.mockResolvedValue({
        attempt: mockAttempt,
        response: null,
      });

      const result = await service.startAttempt(formId, userId, {}, clientIp);

      expect(result.attemptId).toBe('attempt-uuid-2');
      expect(result.responseId).toBeNull();
      expect(result.type).toBe('EXTERNAL');
      expect(result.externalUrl).toBe(extUrl);
    });

    it('should reject with SurveyNotAvailableException if form does not exist', async () => {
      mockFormRepo.findById.mockResolvedValue(null);

      await expect(
        service.startAttempt('non-existent-id', userId, {}, clientIp),
      ).rejects.toThrow(SurveyNotAvailableException);
    });

    it('should reject with SurveyNotAvailableException if form is not published', async () => {
      const formWithVersion = createMockFormWithVersion({ status: 'DRAFT' });
      mockFormRepo.findById.mockResolvedValue(formWithVersion);

      await expect(
        service.startAttempt(formId, userId, {}, clientIp),
      ).rejects.toThrow(SurveyNotAvailableException);
    });

    it('should reject with ParticipantNotEligibleException if user demographic targeting does not match', async () => {
      const formWithVersion = createMockFormWithVersion({
        targetingJson: { ageRange: { min: 20, max: 25 } },
      });
      mockFormRepo.findById.mockResolvedValue(formWithVersion);

      // User is 30 years old
      const profile = new DemographicProfileEntity(
        'profile-1',
        userId,
        30,
        'MALE',
        'Da Nang',
        'Developer',
        'IT',
        null,
        null,
        new Date(),
        new Date(),
      );
      mockDemographicRepo.findByUserId.mockResolvedValue(profile);

      await expect(
        service.startAttempt(formId, userId, {}, clientIp),
      ).rejects.toThrow(ParticipantNotEligibleException);
    });

    it('should reject with SurveyAlreadyCompletedException if user has completed logical form', async () => {
      const formWithVersion = createMockFormWithVersion();
      mockFormRepo.findById.mockResolvedValue(formWithVersion);
      mockParticipationRepo.hasCompletedLogicalForm.mockResolvedValue(true);

      await expect(
        service.startAttempt(formId, userId, {}, clientIp),
      ).rejects.toThrow(SurveyAlreadyCompletedException);
    });

    it('should reject with ConflictingActiveAttemptException if user already has an active unexpired attempt', async () => {
      const formWithVersion = createMockFormWithVersion();
      mockFormRepo.findById.mockResolvedValue(formWithVersion);

      const existingActiveAttempt = new SurveyAttemptEntity(
        'existing-attempt-uuid',
        formId,
        formVersionId,
        userId,
        'IN_PROGRESS',
        false,
        new Date(),
        null,
        null,
        new Date(),
        new Date(),
      );
      mockParticipationRepo.findConflictingActiveAttempt.mockResolvedValue(existingActiveAttempt);

      await expect(
        service.startAttempt(formId, userId, {}, clientIp),
      ).rejects.toThrow(ConflictingActiveAttemptException);
    });

    it('should reject with SurveyQuotaFullException if remaining quota is 0', async () => {
      const formWithVersion = createMockFormWithVersion({ expectedCompletions: 5 });
      mockFormRepo.findById.mockResolvedValue(formWithVersion);

      mockParticipationRepo.getQuotaStatus.mockResolvedValue({
        completedCount: 3,
        activeReservationCount: 2, // 3 + 2 = 5 >= 5
      });

      await expect(
        service.startAttempt(formId, userId, {}, clientIp),
      ).rejects.toThrow(SurveyQuotaFullException);
    });

    it('should allow attempt if previous attempt is expired and cleaned up', async () => {
      const formWithVersion = createMockFormWithVersion({ expectedCompletions: 10 });
      mockFormRepo.findById.mockResolvedValue(formWithVersion);
      mockParticipationRepo.abandonExpiredAttempts.mockResolvedValue(1);
      mockParticipationRepo.findConflictingActiveAttempt.mockResolvedValue(null);

      const mockAttempt = new SurveyAttemptEntity(
        'new-attempt-uuid',
        formId,
        formVersionId,
        userId,
        'IN_PROGRESS',
        false,
        new Date(),
        null,
        null,
        new Date(),
        new Date(),
      );

      const mockResponse = new ResponseEntity(
        'new-response-uuid',
        formId,
        formVersionId,
        'new-attempt-uuid',
        userId,
        'IN_PROGRESS',
        null,
        clientIp,
        false,
        null,
        new Date(),
        new Date(),
      );

      mockParticipationRepo.createAttemptWithResponse.mockResolvedValue({
        attempt: mockAttempt,
        response: mockResponse,
      });

      const result = await service.startAttempt(formId, userId, {}, clientIp);
      expect(result.attemptId).toBe('new-attempt-uuid');
      expect(mockParticipationRepo.abandonExpiredAttempts).toHaveBeenCalledWith(
        userId,
        formId,
        expect.any(Date),
      );
    });
  });

  describe('recordTelemetryEvents', () => {
    const attemptId = 'att-1111-1111-1111-111111111111';
    const clientEventId = 'evt-2222-2222-2222-222222222222';

    it('should successfully record telemetry events for a valid attempt', () => {
      const mockAttempt = new SurveyAttemptEntity(
        attemptId,
        formId,
        formVersionId,
        userId,
        'IN_PROGRESS',
        false,
        new Date(),
        null,
        null,
        new Date(),
        new Date(),
      );

      mockParticipationRepo.findAttemptById.mockResolvedValue(mockAttempt);
      mockParticipationRepo.saveIntegrityEvents = jest.fn().mockResolvedValue(1);

      return service
        .recordTelemetryEvents(formId, attemptId, userId, {
          events: [
            {
              clientEventId,
              eventType: 'QUESTION_SHOWN',
              attemptId,
              formVersionId,
              occurredAt: new Date().toISOString(),
            },
          ],
        })
        .then((res) => {
          expect(res.success).toBe(true);
          expect(res.ingestedCount).toBe(1);
          expect(res.attemptId).toBe(attemptId);
          expect(mockParticipationRepo.saveIntegrityEvents).toHaveBeenCalledTimes(1);
        });
    });

    it('should throw SurveyNotAvailableException if attempt not found', async () => {
      mockParticipationRepo.findAttemptById.mockResolvedValue(null);

      await expect(
        service.recordTelemetryEvents(formId, 'missing-attempt', userId, {
          events: [
            {
              clientEventId,
              eventType: 'QUESTION_SHOWN',
              attemptId: 'missing-attempt',
              formVersionId,
              occurredAt: new Date().toISOString(),
            },
          ],
        }),
      ).rejects.toThrow(SurveyNotAvailableException);
    });

    it('should throw ParticipantNotEligibleException if user does not own the attempt', async () => {
      const mockAttempt = new SurveyAttemptEntity(
        attemptId,
        formId,
        formVersionId,
        'another-user-id',
        'IN_PROGRESS',
        false,
        new Date(),
        null,
        null,
        new Date(),
        new Date(),
      );

      mockParticipationRepo.findAttemptById.mockResolvedValue(mockAttempt);

      await expect(
        service.recordTelemetryEvents(formId, attemptId, userId, {
          events: [
            {
              clientEventId,
              eventType: 'QUESTION_SHOWN',
              attemptId,
              formVersionId,
              occurredAt: new Date().toISOString(),
            },
          ],
        }),
      ).rejects.toThrow(ParticipantNotEligibleException);
    });
  });

  describe('recordResponseTelemetryEvents', () => {
    const responseId = 'resp-3333-3333-3333-333333333333';
    const attemptId = 'att-1111-1111-1111-111111111111';
    const clientEventId = 'evt-2222-2222-2222-222222222222';

    it('should find response and delegate to recordTelemetryEvents', async () => {
      const mockResponse = new ResponseEntity(
        responseId,
        formId,
        formVersionId,
        attemptId,
        userId,
        'IN_PROGRESS',
        null,
        clientIp,
        false,
        null,
        new Date(),
        new Date(),
      );
      const mockAttempt = new SurveyAttemptEntity(
        attemptId,
        formId,
        formVersionId,
        userId,
        'IN_PROGRESS',
        false,
        new Date(),
        null,
        null,
        new Date(),
        new Date(),
      );

      mockParticipationRepo.findResponseById = jest.fn().mockResolvedValue(mockResponse);
      mockParticipationRepo.findAttemptById.mockResolvedValue(mockAttempt);
      mockParticipationRepo.saveIntegrityEvents = jest.fn().mockResolvedValue(1);

      const result = await service.recordResponseTelemetryEvents(
        responseId,
        userId,
        {
          events: [
            {
              clientEventId,
              eventType: 'ANSWER_SELECTED',
              attemptId,
              formVersionId,
              responseId,
              occurredAt: new Date().toISOString(),
            },
          ],
        },
      );

      expect(result.success).toBe(true);
      expect(result.ingestedCount).toBe(1);
    });

    it('should throw SurveyNotAvailableException if response not found', async () => {
      mockParticipationRepo.findResponseById = jest.fn().mockResolvedValue(null);

      await expect(
        service.recordResponseTelemetryEvents('missing-response', userId, {
          events: [
            {
              clientEventId,
              eventType: 'ANSWER_SELECTED',
              attemptId,
              formVersionId,
              occurredAt: new Date().toISOString(),
            },
          ],
        }),
      ).rejects.toThrow(SurveyNotAvailableException);
    });
  });
});

