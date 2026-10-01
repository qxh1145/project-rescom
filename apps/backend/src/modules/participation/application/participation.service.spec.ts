import { ParticipationService } from './participation.service';
import { ParticipationRepositoryPort } from './ports/participation-repository.port';
import {
  FormRepositoryPort,
  FormWithVersion,
} from '../../forms/application/ports/form-repository.port';
import { DemographicProfileRepositoryPort } from '../../users/application/ports/demographic-profile.repository.port';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import { DemographicProfileEntity } from '../../users/domain/demographic-profile.entity';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';
import { ResponseEntity } from '../domain/response.entity';
import {
  ParticipantNotEligibleException,
  SelfParticipationForbiddenException,
  SurveyAlreadyCompletedException,
  SurveyQuotaFullException,
  ConflictingActiveAttemptException,
  SurveyNotAvailableException,
  ResponseNotFoundException,
  AttemptExpiredException,
  InvalidFormSubmissionException,
  SubmissionTooFastException,
  InvalidCompletionCodeException,
  AttemptLockedException,
  AttemptNotExternalException,
  RewardNotSettleableException,
  SurveyRewardUnavailableException,
  TelemetryRejectedException,
} from './exceptions/participation.exceptions';
import { InsufficientEscrowBalanceException } from '../../economy/application/exceptions/economy.exceptions';
import { RewardSettlementCoordinator } from '../../economy/application/reward-settlement.coordinator';
import { LedgerService } from '../../economy/application/ledger.service';
import { InMemoryLedgerRepository } from '../../economy/infrastructure/in-memory-ledger.repository';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { InMemoryNotificationRepository } from '../../notifications/infrastructure/in-memory-notification.repository';
import { StarterPointsCoordinator } from '../../economy/application/starter-points.coordinator';
import { DemographicProfileRequiredException } from '../../users/application/exceptions/demographics.exceptions';
import { CompletionCodePort } from '../../forms/application/ports/completion-code.port';
import {
  createStorageCapability,
  verifyStorageCapability,
} from '../../../common/security/storage-capability';

describe('ParticipationService', () => {
  let service: ParticipationService;
  let mockFormRepo: jest.Mocked<FormRepositoryPort>;
  let mockDemographicRepo: jest.Mocked<DemographicProfileRepositoryPort>;
  let mockParticipationRepo: jest.Mocked<ParticipationRepositoryPort>;
  let mockRewardSettlementCoordinator: jest.Mocked<RewardSettlementCoordinator>;
  let mockCompletionCodeService: jest.Mocked<CompletionCodePort>;

  const userId = 'user-1111-1111-1111-111111111111';
  const formId = 'form-2222-2222-2222-222222222222';
  const formVersionId = 'ver-3333-3333-3333-333333333333';
  const clientIp = '127.0.0.1';

  function createProfile(
    overrides: Partial<{
      age: number | null;
      occupation: string | null;
      householdIncome: string | null;
      specificInterests: string[] | null;
    }> = {},
  ): DemographicProfileEntity {
    return new DemographicProfileEntity(
      'profile-1',
      userId,
      'age' in overrides ? (overrides.age ?? null) : 22,
      'MALE',
      'Da Nang',
      'occupation' in overrides ? (overrides.occupation ?? null) : 'Developer',
      'IT',
      'householdIncome' in overrides
        ? (overrides.householdIncome ?? null)
        : '10 - 20 triệu VNĐ/tháng',
      'specificInterests' in overrides
        ? (overrides.specificInterests ?? null)
        : ['AI'],
      new Date(),
      new Date(),
    );
  }

  function createMockFormWithVersion(overrides?: {
    status?:
      'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ESCROW_LOCKED' | 'MODERATION_QUEUE';
    type?: 'INTERNAL' | 'EXTERNAL';
    expectedCompletions?: number;
    targetingJson?: Record<string, unknown> | null;
    externalUrl?: string | null;
    publisherId?: string;
  }): FormWithVersion {
    const form = new FormEntity(
      formId,
      overrides?.publisherId ?? 'publisher-id',
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
      findPublishedSummaryById: jest.fn(),
      create: jest.fn(),
      findManyByPublisher: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createVersion: jest.fn(),
      findAllVersions: jest.fn(),
      findPublishedForms: jest.fn(),
      listRewardableCompletions: jest.fn().mockResolvedValue({
        completedCount: 0,
        internalResponses: [],
        externalAttemptIds: [],
      }),
      listEscrowInputsByFormIds: jest.fn().mockResolvedValue(new Map()),
      findModerationQueue: jest.fn(),
      findByCreationKey: jest.fn(),
      countInProgressAttempts: jest.fn().mockResolvedValue(0),
      countCompletionsInBuckets: jest.fn(),
      countExternalCompletionsSince: jest.fn(),
      findLatestRejection: jest.fn().mockResolvedValue(null),
      // Story IR.2b (deadline-close job; not used by this service).
      findFormsPastDeadline: jest.fn().mockResolvedValue([]),
      findQuotaState: jest.fn().mockResolvedValue(null),
    };

    mockDemographicRepo = {
      // Story 7.1: authenticated attempts require a complete FR-6 profile.
      findByUserId: jest.fn().mockResolvedValue(createProfile()),
      upsert: jest.fn(),
    };

    mockParticipationRepo = {
      hasCompletedLogicalForm: jest.fn().mockResolvedValue(false),
      findConflictingActiveAttempt: jest.fn().mockResolvedValue(null),
      abandonExpiredAttempts: jest.fn().mockResolvedValue(0),
      // Story IR.2b (reservation-expiry job; not used by this service).
      abandonExpiredAttemptsBatch: jest
        .fn()
        .mockResolvedValue({ abandonedIds: [] }),
      getQuotaStatus: jest
        .fn()
        .mockResolvedValue({ completedCount: 0, activeReservationCount: 0 }),
      reserveAttempt: jest.fn(),
      lockAttemptForVerification: jest.fn(),
      findAttemptById: jest.fn(),
      findResponseById: jest.fn(),
      saveIntegrityEvents: jest.fn().mockResolvedValue(0),
      findResponseByAttemptId: jest.fn(),
      findActivePolicyDeployment: jest.fn().mockResolvedValue(null),
      submitInternalResponseTransaction: jest.fn(),
      recordFailedAttemptVerification: jest.fn(),
      recordFraudLog: jest.fn().mockResolvedValue(true),
      findCompletionTimesSince: jest.fn().mockResolvedValue([]),
      // Decisions E5-D1 / E8-D6.
      countCompletionCodeFailures: jest.fn().mockResolvedValue(0),
      resetCompletionCodeFailures: jest.fn(),
      findOpenAttemptStartTimes: jest.fn().mockResolvedValue([]),
      completeExternalAttemptTransaction: jest.fn(),
      findInternalRewardRequest: jest.fn().mockResolvedValue(null),
      reportMissingCompletionCode: jest.fn(),
      // Story IR.2a (the runner's cancel command, not used by this service).
      cancelAttempt: jest.fn(),
    };

    mockCompletionCodeService = {
      generateSixDigitCode: jest.fn().mockReturnValue('123456'),
      deriveSixDigitCode: jest.fn().mockReturnValue('654321'),
      computeVerifier: jest.fn().mockReturnValue('v1:mockdigest'),
      verifyCode: jest.fn().mockReturnValue(true),
      parseVerifier: jest.fn(),
      canVerify: jest.fn().mockReturnValue(true),
    };

    mockRewardSettlementCoordinator = {
      settleInternalReward: jest.fn().mockResolvedValue({
        status: 'SETTLED',
        journalId: 'journal-uuid-1',
        amount: 50,
        targetAccountClass: 'USER_AVAILABLE',
        settledAt: new Date().toISOString(),
      }),
      settleExternalReward: jest.fn().mockResolvedValue({
        status: 'PENDING',
        journalId: 'journal-uuid-ext-1',
        amount: 50,
        targetAccountClass: 'PENDING',
        settledAt: new Date().toISOString(),
      }),
      // Epic 6 review P5: no posted settlement unless a test says so.
      findInternalSettlement: jest.fn().mockResolvedValue(null),
      findExternalSettlement: jest.fn().mockResolvedValue(null),
      // Epic 9 review P1: replays recover the notice only while PENDING.
      getExternalCreditState: jest.fn().mockResolvedValue('PENDING'),
    } as any;

    service = new ParticipationService(
      mockFormRepo,
      mockDemographicRepo,
      mockParticipationRepo,
      mockRewardSettlementCoordinator,
      mockCompletionCodeService,
    );
  });

  describe('startAttempt', () => {
    it('should successfully start an INTERNAL attempt and create durable Response identity in the same transaction', async () => {
      const formWithVersion = createMockFormWithVersion({ type: 'INTERNAL' });
      mockFormRepo.findById.mockResolvedValue(formWithVersion);

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

      mockParticipationRepo.reserveAttempt.mockResolvedValue({
        outcome: 'CREATED',
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
      expect(mockParticipationRepo.reserveAttempt).toHaveBeenCalledTimes(1);
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

      mockParticipationRepo.reserveAttempt.mockResolvedValue({
        outcome: 'CREATED',
        attempt: mockAttempt,
        response: null,
      });

      const result = await service.startAttempt(formId, userId, {}, clientIp);

      expect(result.attemptId).toBe('attempt-uuid-2');
      expect(result.responseId).toBeNull();
      expect(result.type).toBe('EXTERNAL');
      expect(result.externalUrl).toBe(extUrl);
    });

    it('should reject with DemographicProfileRequiredException when the user has no profile (Story 7.1)', async () => {
      mockFormRepo.findById.mockResolvedValue(createMockFormWithVersion());
      mockDemographicRepo.findByUserId.mockResolvedValue(null);

      const error = await service
        .startAttempt(formId, userId, {}, clientIp)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DemographicProfileRequiredException);
      expect(
        (error as DemographicProfileRequiredException).missingFields,
      ).toHaveLength(7);
      expect(mockParticipationRepo.getQuotaStatus).not.toHaveBeenCalled();
      expect(mockParticipationRepo.reserveAttempt).not.toHaveBeenCalled();
    });

    it('should reject an incomplete profile even for an open-targeting survey (Story 7.1)', async () => {
      mockFormRepo.findById.mockResolvedValue(
        createMockFormWithVersion({ targetingJson: null }),
      );
      mockDemographicRepo.findByUserId.mockResolvedValue(
        createProfile({ householdIncome: null, specificInterests: [] }),
      );

      await expect(
        service.startAttempt(formId, userId, {}, clientIp),
      ).rejects.toMatchObject({
        code: 'DEMOGRAPHIC_PROFILE_REQUIRED',
        missingFields: ['householdIncome', 'specificInterests'],
      });
      expect(mockFormRepo.findById).not.toHaveBeenCalled();
      expect(mockParticipationRepo.reserveAttempt).not.toHaveBeenCalled();
    });

    it('should not require a demographic profile for guest attempts (userId = null)', async () => {
      mockFormRepo.findById.mockResolvedValue(createMockFormWithVersion());
      mockDemographicRepo.findByUserId.mockResolvedValue(null);
      mockParticipationRepo.reserveAttempt.mockResolvedValue({
        outcome: 'CREATED',
        attempt: new SurveyAttemptEntity(
          'guest-attempt',
          formId,
          formVersionId,
          null,
          'IN_PROGRESS',
          true,
          new Date(),
          null,
          null,
          new Date(),
          new Date(),
        ),
        response: null,
      });

      const result = await service.startAttempt(formId, null, {}, clientIp);

      expect(result.attemptId).toBe('guest-attempt');
      expect(mockDemographicRepo.findByUserId).not.toHaveBeenCalled();
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

    it.each(['INTERNAL', 'EXTERNAL'] as const)(
      'refuses the survey owner with SelfParticipationForbiddenException before any reservation (%s, decision E4-DN2)',
      async (type) => {
        mockFormRepo.findById.mockResolvedValue(
          createMockFormWithVersion({ type, publisherId: userId }),
        );

        const attempt = service.startAttempt(formId, userId, {}, clientIp);

        await expect(attempt).rejects.toBeInstanceOf(
          SelfParticipationForbiddenException,
        );
        await expect(attempt).rejects.toMatchObject({
          code: 'SELF_PARTICIPATION_FORBIDDEN',
        });
        expect(mockParticipationRepo.reserveAttempt).not.toHaveBeenCalled();
      },
    );

    it('should reject with ParticipantNotEligibleException if user demographic targeting does not match', async () => {
      const formWithVersion = createMockFormWithVersion({
        targetingJson: { ageRange: { min: 20, max: 25 } },
      });
      mockFormRepo.findById.mockResolvedValue(formWithVersion);

      // User is 30 years old
      mockDemographicRepo.findByUserId.mockResolvedValue(
        createProfile({ age: 30 }),
      );

      await expect(
        service.startAttempt(formId, userId, {}, clientIp),
      ).rejects.toThrow(ParticipantNotEligibleException);
    });

    it.each([
      ['a non-string location entry', { locations: [1] }],
      ['an unknown key', { foo: 1 }],
      ['a non-array criterion', { occupations: 'Student' }],
    ])(
      'fails closed with ParticipantNotEligibleException on malformed stored targeting (%s) (review P12)',
      async (_label, targetingJson) => {
        mockFormRepo.findById.mockResolvedValue(
          createMockFormWithVersion({ targetingJson }),
        );

        await expect(
          service.startAttempt(formId, userId, {}, clientIp),
        ).rejects.toThrow(ParticipantNotEligibleException);
        expect(mockParticipationRepo.reserveAttempt).not.toHaveBeenCalled();
      },
    );

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
      mockParticipationRepo.findConflictingActiveAttempt.mockResolvedValue(
        existingActiveAttempt,
      );

      await expect(
        service.startAttempt(formId, userId, {}, clientIp),
      ).rejects.toThrow(ConflictingActiveAttemptException);
    });

    it('should reject with SurveyQuotaFullException if remaining quota is 0', async () => {
      const formWithVersion = createMockFormWithVersion({
        expectedCompletions: 5,
      });
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
      const formWithVersion = createMockFormWithVersion({
        expectedCompletions: 10,
      });
      mockFormRepo.findById.mockResolvedValue(formWithVersion);
      mockParticipationRepo.abandonExpiredAttempts.mockResolvedValue(1);
      mockParticipationRepo.findConflictingActiveAttempt.mockResolvedValue(
        null,
      );

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

      mockParticipationRepo.reserveAttempt.mockResolvedValue({
        outcome: 'CREATED',
        attempt: mockAttempt,
        response: mockResponse,
      });

      const result = await service.startAttempt(formId, userId, {}, clientIp);
      expect(result.attemptId).toBe('new-attempt-uuid');
      // Expired attempts are abandoned inside the reservation transaction.
      expect(mockParticipationRepo.reserveAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          formId,
          respondentId: userId,
          expectedCompletions: 10,
          cutoffDate: expect.any(Date),
        }),
      );
    });

    describe('atomic reservation outcomes (Epic 5 review P1/P24)', () => {
      beforeEach(() => {
        mockFormRepo.findById.mockResolvedValue(createMockFormWithVersion());
      });

      it.each([
        ['NOT_OPEN', SurveyNotAvailableException],
        ['ALREADY_COMPLETED', SurveyAlreadyCompletedException],
        ['QUOTA_FULL', SurveyQuotaFullException],
      ] as const)(
        'maps a %s reservation to its 4xx exception',
        async (outcome, exception) => {
          mockParticipationRepo.reserveAttempt.mockResolvedValue({ outcome });
          await expect(
            service.startAttempt(formId, userId, {}, clientIp),
          ).rejects.toBeInstanceOf(exception);
        },
      );

      it('maps a CONFLICTING_ACTIVE race to 409 with the caller-owned attempt details', async () => {
        const startedAt = new Date();
        const active = new SurveyAttemptEntity(
          'active-attempt',
          formId,
          formVersionId,
          userId,
          'IN_PROGRESS',
          false,
          startedAt,
          null,
          null,
          startedAt,
          startedAt,
        );
        // The unique index caught the race: no attempt in the outcome, so the
        // service re-reads the caller's active attempt for the details.
        mockParticipationRepo.reserveAttempt.mockResolvedValue({
          outcome: 'CONFLICTING_ACTIVE',
          attempt: null,
        });
        mockParticipationRepo.findConflictingActiveAttempt
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(active);
        mockParticipationRepo.findResponseByAttemptId.mockResolvedValue(
          new ResponseEntity(
            'active-response',
            formId,
            formVersionId,
            'active-attempt',
            userId,
            'IN_PROGRESS',
            null,
            clientIp,
            false,
            null,
            startedAt,
            startedAt,
          ),
        );

        const error = (await service
          .startAttempt(formId, userId, {}, clientIp)
          .catch((e: unknown) => e)) as ConflictingActiveAttemptException;

        expect(error).toBeInstanceOf(ConflictingActiveAttemptException);
        expect(error.details).toEqual({
          attemptId: 'active-attempt',
          responseId: 'active-response',
          formVersionId,
          type: 'INTERNAL',
          expiresAt: new Date(
            startedAt.getTime() + 30 * 60 * 1000,
          ).toISOString(),
        });
      });

      it('pre-check conflict also carries the resume details', async () => {
        const startedAt = new Date();
        mockParticipationRepo.findConflictingActiveAttempt.mockResolvedValue(
          new SurveyAttemptEntity(
            'active-attempt',
            formId,
            formVersionId,
            userId,
            'IN_PROGRESS',
            false,
            startedAt,
            null,
            null,
            startedAt,
            startedAt,
          ),
        );
        mockParticipationRepo.findResponseByAttemptId.mockResolvedValue(null);

        const error = (await service
          .startAttempt(formId, userId, {}, clientIp)
          .catch((e: unknown) => e)) as ConflictingActiveAttemptException;

        expect(error.details?.attemptId).toBe('active-attempt');
        expect(mockParticipationRepo.reserveAttempt).not.toHaveBeenCalled();
      });

      it('mints the storage capability with the configured secret, never a literal (P22)', async () => {
        const secret = 'configured_storage_capability_secret_32+';
        const configured = new ParticipationService(
          mockFormRepo,
          mockDemographicRepo,
          mockParticipationRepo,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { storageCapabilitySecret: secret },
        );
        const attempt = new SurveyAttemptEntity(
          'cap-attempt',
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
        mockParticipationRepo.reserveAttempt.mockResolvedValue({
          outcome: 'CREATED',
          attempt,
          response: null,
        });

        const result = await configured.startAttempt(
          formId,
          userId,
          {},
          clientIp,
        );
        expect(
          verifyStorageCapability(
            secret,
            'cap-attempt',
            result.storageCapability,
          ),
        ).toBe(true);
      });
    });
  });

  describe('recordTelemetryEvents', () => {
    const attemptId = 'att-1111-1111-1111-111111111111';
    const clientEventId = 'evt-2222-2222-2222-222222222222';

    function telemetryResponse(): ResponseEntity {
      return new ResponseEntity(
        'resp-1111',
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
    }

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
      mockParticipationRepo.findResponseByAttemptId.mockResolvedValue(
        telemetryResponse(),
      );
      mockParticipationRepo.saveIntegrityEvents = jest
        .fn()
        .mockResolvedValue(1);

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
          expect(
            mockParticipationRepo.saveIntegrityEvents,
          ).toHaveBeenCalledTimes(1);
        });
    });

    describe('ownership, state and event checks (Epic 5 review P8/P14)', () => {
      function attemptWith(
        overrides: Partial<{
          respondentId: string | null;
          status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'LOCKED';
          startedAt: Date;
          submittedAt: Date | null;
        }> = {},
      ) {
        return new SurveyAttemptEntity(
          attemptId,
          formId,
          formVersionId,
          'respondentId' in overrides ? overrides.respondentId! : userId,
          overrides.status ?? 'IN_PROGRESS',
          overrides.respondentId === null,
          overrides.startedAt ?? new Date(),
          overrides.submittedAt ?? null,
          null,
          new Date(),
          new Date(),
        );
      }

      function batch(
        overrides: Partial<{
          attemptId: string;
          formVersionId: string;
          responseId: string | null;
          occurredAt: string;
        }> = {},
      ) {
        return {
          events: [
            {
              clientEventId,
              eventType: 'QUESTION_SHOWN' as const,
              attemptId: overrides.attemptId ?? attemptId,
              formVersionId: overrides.formVersionId ?? formVersionId,
              responseId: overrides.responseId,
              occurredAt: overrides.occurredAt ?? new Date().toISOString(),
            },
          ],
        };
      }

      beforeEach(() => {
        mockParticipationRepo.findResponseByAttemptId.mockResolvedValue(
          telemetryResponse(),
        );
        mockParticipationRepo.saveIntegrityEvents.mockResolvedValue(1);
      });

      it('rejects an anonymous caller for an account-owned attempt (403)', async () => {
        mockParticipationRepo.findAttemptById.mockResolvedValue(attemptWith());
        await expect(
          service.recordTelemetryEvents(formId, attemptId, null, batch()),
        ).rejects.toBeInstanceOf(ParticipantNotEligibleException);
        expect(
          mockParticipationRepo.saveIntegrityEvents,
        ).not.toHaveBeenCalled();
      });

      it('requires the attempt capability for a guest attempt', async () => {
        const secret = 'telemetry_guest_capability_secret_32chars';
        const guestService = new ParticipationService(
          mockFormRepo,
          mockDemographicRepo,
          mockParticipationRepo,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { storageCapabilitySecret: secret },
        );
        mockParticipationRepo.findAttemptById.mockResolvedValue(
          attemptWith({ respondentId: null }),
        );

        await expect(
          guestService.recordTelemetryEvents(formId, attemptId, null, batch()),
        ).rejects.toBeInstanceOf(ParticipantNotEligibleException);
        await expect(
          guestService.recordTelemetryEvents(
            formId,
            attemptId,
            null,
            batch(),
            createStorageCapability(secret, attemptId),
          ),
        ).resolves.toMatchObject({ ingestedCount: 1 });
      });

      it('rejects telemetry for an External attempt (FR-58)', async () => {
        mockParticipationRepo.findAttemptById.mockResolvedValue(attemptWith());
        mockParticipationRepo.findResponseByAttemptId.mockResolvedValue(null);
        await expect(
          service.recordTelemetryEvents(formId, attemptId, userId, batch()),
        ).rejects.toBeInstanceOf(TelemetryRejectedException);
      });

      it('rejects an expired or abandoned attempt (409)', async () => {
        mockParticipationRepo.findAttemptById.mockResolvedValue(
          attemptWith({ startedAt: new Date(Date.now() - 31 * 60 * 1000) }),
        );
        await expect(
          service.recordTelemetryEvents(formId, attemptId, userId, batch()),
        ).rejects.toBeInstanceOf(AttemptExpiredException);

        mockParticipationRepo.findAttemptById.mockResolvedValue(
          attemptWith({ status: 'ABANDONED' }),
        );
        await expect(
          service.recordTelemetryEvents(formId, attemptId, userId, batch()),
        ).rejects.toBeInstanceOf(AttemptExpiredException);
      });

      it('accepts the final flush within 2 minutes of submission, not after', async () => {
        mockParticipationRepo.findAttemptById.mockResolvedValue(
          attemptWith({
            status: 'COMPLETED',
            startedAt: new Date(Date.now() - 10 * 60 * 1000),
            submittedAt: new Date(Date.now() - 60 * 1000),
          }),
        );
        await expect(
          service.recordTelemetryEvents(formId, attemptId, userId, batch()),
        ).resolves.toMatchObject({ success: true });

        mockParticipationRepo.findAttemptById.mockResolvedValue(
          attemptWith({
            status: 'COMPLETED',
            startedAt: new Date(Date.now() - 10 * 60 * 1000),
            submittedAt: new Date(Date.now() - 3 * 60 * 1000),
          }),
        );
        await expect(
          service.recordTelemetryEvents(formId, attemptId, userId, batch()),
        ).rejects.toBeInstanceOf(AttemptExpiredException);
      });

      it.each([
        ['another attempt', { attemptId: 'att-9999-9999-9999-999999999999' }],
        ['another version', { formVersionId: 'ver-9999' }],
        ['another response', { responseId: 'resp-9999' }],
        [
          'a timestamp far in the future',
          {
            occurredAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          },
        ],
        [
          'a timestamp long before the attempt',
          {
            occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          },
        ],
      ])('rejects an event of %s (400)', async (_label, overrides) => {
        mockParticipationRepo.findAttemptById.mockResolvedValue(attemptWith());
        await expect(
          service.recordTelemetryEvents(
            formId,
            attemptId,
            userId,
            batch(overrides),
          ),
        ).rejects.toBeInstanceOf(TelemetryRejectedException);
        expect(
          mockParticipationRepo.saveIntegrityEvents,
        ).not.toHaveBeenCalled();
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

      mockParticipationRepo.findResponseById = jest
        .fn()
        .mockResolvedValue(mockResponse);
      mockParticipationRepo.findAttemptById.mockResolvedValue(mockAttempt);
      mockParticipationRepo.saveIntegrityEvents = jest
        .fn()
        .mockResolvedValue(1);

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
      mockParticipationRepo.findResponseById = jest
        .fn()
        .mockResolvedValue(null);

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

  describe('submitInternalResponse', () => {
    const responseId = 'resp-9999-9999-9999-999999999999';
    const attemptId = 'att-8888-8888-8888-888888888888';

    function setupMockSubmissionData(overrides?: {
      responseStatus?: 'IN_PROGRESS' | 'VALIDATED' | 'SUBMITTED';
      isGuest?: boolean;
      respondentId?: string | null;
      attemptStartedAt?: Date;
      attemptStatus?: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'LOCKED';
      minTimeBarrierSeconds?: number;
    }) {
      const form = new FormEntity(
        formId,
        'publisher-id-1',
        'INTERNAL',
        'PUBLISHED',
        'Sample Survey',
        'Description',
        50,
        10,
        new Date(),
        new Date(),
      );

      const currentVersion = new FormVersionEntity(
        formVersionId,
        formId,
        1,
        {
          title: 'Schema',
          settings: { requireAuth: true },
          metadata: {
            expectedEffortSeconds: 60,
            minTimeBarrierSeconds: overrides?.minTimeBarrierSeconds ?? 15,
          },
          blocks: [
            {
              id: 'block-q1',
              order: 0,
              title: 'Your Feedback',
              type: 'text',
              required: true,
              minLength: 3,
            },
            {
              id: 'block-q2',
              order: 1,
              title: 'Rating',
              type: 'rating',
              required: false,
              maxRating: 5,
            },
          ],
        } as any,
        null,
        true,
        null,
        null,
        new Date(),
        new Date(),
      );

      mockFormRepo.findById.mockResolvedValue({ form, currentVersion });

      const attempt = new SurveyAttemptEntity(
        attemptId,
        formId,
        formVersionId,
        overrides?.respondentId !== undefined ? overrides.respondentId : userId,
        overrides?.attemptStatus ?? 'IN_PROGRESS',
        overrides?.isGuest ?? false,
        overrides?.attemptStartedAt ?? new Date(Date.now() - 60000), // 1 min ago
        null,
        null,
        new Date(),
        new Date(),
      );

      const response = new ResponseEntity(
        responseId,
        formId,
        formVersionId,
        attemptId,
        overrides?.respondentId !== undefined ? overrides.respondentId : userId,
        overrides?.responseStatus ?? 'IN_PROGRESS',
        null,
        clientIp,
        overrides?.isGuest ?? false,
        null,
        new Date(),
        new Date(),
      );

      mockParticipationRepo.findResponseById.mockResolvedValue(response);
      mockParticipationRepo.findAttemptById.mockResolvedValue(attempt);

      const updatedResponse = new ResponseEntity(
        responseId,
        formId,
        formVersionId,
        attemptId,
        overrides?.respondentId !== undefined ? overrides.respondentId : userId,
        'VALIDATED',
        { 'block-q1': 'Awesome experience' },
        clientIp,
        overrides?.isGuest ?? false,
        new Date(),
        new Date(),
        new Date(),
      );

      const updatedAttempt = new SurveyAttemptEntity(
        attemptId,
        formId,
        formVersionId,
        overrides?.respondentId !== undefined ? overrides.respondentId : userId,
        'COMPLETED',
        overrides?.isGuest ?? false,
        attempt.startedAt,
        new Date(),
        null,
        new Date(),
        new Date(),
      );

      mockParticipationRepo.submitInternalResponseTransaction.mockResolvedValue(
        {
          outcome: 'SUBMITTED',
          response: updatedResponse,
          attempt: updatedAttempt,
          outboxEventIds: ['outbox-1', 'outbox-2'],
        },
      );

      return { form, currentVersion, attempt, response };
    }

    it('should successfully submit an internal response in SHADOW mode with instant reward', async () => {
      setupMockSubmissionData();

      const result = await service.submitInternalResponse(responseId, userId, {
        answers: { 'block-q1': 'Awesome experience' },
      });

      expect(result.status).toBe('VALIDATED');
      expect(result.policyMode).toBe('SHADOW');
      expect(result.responseId).toBe(responseId);
      expect(result.reward).toBeDefined();
      expect(result.reward?.status).toBe('SETTLED');
      expect(
        mockParticipationRepo.submitInternalResponseTransaction,
      ).toHaveBeenCalled();
      expect(
        mockRewardSettlementCoordinator.settleInternalReward,
      ).toHaveBeenCalledWith({
        responseId,
        publisherId: 'publisher-id-1',
        respondentId: userId,
        rewardPerResponse: 50,
        policyMode: 'SHADOW',
      });
    });

    it('triggers the starter points unlock check when coordinator is present', async () => {
      setupMockSubmissionData();
      const mockStarterCoordinator = {
        tryUnlockStarterPoints: jest
          .fn()
          .mockResolvedValue({ unlocked: true, amount: 100 }),
      } as any;

      const serviceWithStarter = new ParticipationService(
        mockFormRepo,
        mockDemographicRepo,
        mockParticipationRepo,
        mockRewardSettlementCoordinator,
        mockCompletionCodeService,
        mockStarterCoordinator,
      );

      await serviceWithStarter.submitInternalResponse(responseId, userId, {
        answers: { 'block-q1': 'Awesome experience' },
      });

      expect(
        mockStarterCoordinator.tryUnlockStarterPoints,
      ).toHaveBeenCalledWith(userId, 'INTERNAL_SUBMISSION');
    });

    it('still returns the submitted response when the starter points unlock fails (Story 7.2)', async () => {
      setupMockSubmissionData();
      const logger = { warn: jest.fn() };
      const failingCoordinator = new StarterPointsCoordinator(
        {
          findJournalByIdempotencyKey: jest
            .fn()
            .mockRejectedValue(new Error('ledger down')),
        } as any,
        {} as any,
        undefined,
        logger,
      );
      const serviceWithStarter = new ParticipationService(
        mockFormRepo,
        mockDemographicRepo,
        mockParticipationRepo,
        mockRewardSettlementCoordinator,
        mockCompletionCodeService,
        failingCoordinator,
      );

      const result = await serviceWithStarter.submitInternalResponse(
        responseId,
        userId,
        { answers: { 'block-q1': 'Awesome experience' } },
      );

      expect(result.status).toBe('VALIDATED');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('INTERNAL_SUBMISSION'),
      );
    });

    it('should submit in ENFORCED mode and place reward on integrity hold', async () => {
      setupMockSubmissionData();
      mockParticipationRepo.findActivePolicyDeployment.mockResolvedValue({
        id: 'policy-enforced-uuid',
        name: 'Strict Policy',
        version: 2,
        status: 'ENFORCED',
      });
      mockRewardSettlementCoordinator.settleInternalReward.mockResolvedValue({
        status: 'HELD_IN_INTEGRITY',
        journalId: 'journal-hold-1',
        amount: 50,
        targetAccountClass: 'INTEGRITY_HOLD',
        settledAt: new Date().toISOString(),
      });

      const result = await service.submitInternalResponse(responseId, userId, {
        answers: { 'block-q1': 'Awesome experience' },
      });

      expect(result.status).toBe('VALIDATED');
      expect(result.policyMode).toBe('ENFORCED');
      expect(result.reward?.status).toBe('HELD_IN_INTEGRITY');
      expect(result.reward?.targetAccountClass).toBe('INTEGRITY_HOLD');
    });

    it('should handle guest submission (skips reward, returns SKIPPED_GUEST)', async () => {
      setupMockSubmissionData({
        isGuest: true,
        respondentId: null,
      });
      mockRewardSettlementCoordinator.settleInternalReward.mockResolvedValue({
        status: 'SKIPPED_GUEST',
        journalId: null,
        amount: 0,
        targetAccountClass: null,
        settledAt: new Date().toISOString(),
      });

      const result = await service.submitInternalResponse(
        responseId,
        null, // guest caller
        {
          answers: { 'block-q1': 'Guest feedback' },
        },
      );

      expect(result.status).toBe('VALIDATED');
      expect(result.reward?.status).toBe('SKIPPED_GUEST');
    });

    it('should return existing VALIDATED result idempotently if already completed', async () => {
      setupMockSubmissionData({
        responseStatus: 'VALIDATED',
      });

      const result = await service.submitInternalResponse(responseId, userId, {
        answers: { 'block-q1': 'Awesome experience' },
      });

      expect(result.status).toBe('VALIDATED');
      expect(
        mockParticipationRepo.submitInternalResponseTransaction,
      ).not.toHaveBeenCalled();
    });

    it('decision E5-D3: a resubmission is an idempotent 200 with the ORIGINAL result (never 409, never re-priced)', async () => {
      setupMockSubmissionData();
      const originalSubmittedAt = new Date('2026-09-26T09:15:00.000Z');
      mockParticipationRepo.findResponseById.mockResolvedValue(
        new ResponseEntity(
          responseId,
          formId,
          formVersionId,
          attemptId,
          userId,
          'VALIDATED',
          { 'block-q1': 'First answer' },
          clientIp,
          false,
          originalSubmittedAt,
          new Date(),
          new Date(),
        ),
      );
      mockParticipationRepo.findInternalRewardRequest.mockResolvedValue({
        publisherId: 'publisher-id-1',
        respondentId: userId,
        rewardAmount: 40,
        policyMode: 'SHADOW',
      });
      const posted = {
        status: 'SETTLED' as const,
        journalId: 'journal-original',
        amount: 40,
        targetAccountClass: 'USER_AVAILABLE' as const,
        settledAt: originalSubmittedAt.toISOString(),
      };
      (
        mockRewardSettlementCoordinator.findInternalSettlement as jest.Mock
      ).mockResolvedValue(posted);

      const result = await service.submitInternalResponse(responseId, userId, {
        answers: { 'block-q1': 'Different answer on retry' },
      });

      expect(result).toEqual({
        responseId,
        attemptId,
        formId,
        formVersionId,
        status: 'VALIDATED',
        submittedAt: originalSubmittedAt.toISOString(),
        reward: posted,
        policyMode: 'SHADOW',
      });
      expect(
        mockParticipationRepo.submitInternalResponseTransaction,
      ).not.toHaveBeenCalled();
      expect(
        mockRewardSettlementCoordinator.settleInternalReward,
      ).not.toHaveBeenCalled();
    });

    it('decision E5-D3: 409 stays for a LOCKED attempt', async () => {
      setupMockSubmissionData({ attemptStatus: 'LOCKED' });

      await expect(
        service.submitInternalResponse(responseId, userId, {
          answers: { 'block-q1': 'text' },
        }),
      ).rejects.toThrow(AttemptExpiredException);
    });

    describe('Epic 6 review P5: settlement after the submission committed', () => {
      it('returns 200 with reward null when settlement fails, and still runs the starter unlock check', async () => {
        setupMockSubmissionData();
        (
          mockRewardSettlementCoordinator.settleInternalReward as jest.Mock
        ).mockRejectedValueOnce(new InsufficientEscrowBalanceException(12, 50));
        const logger = { warn: jest.fn() };
        const starter = {
          tryUnlockStarterPoints: jest.fn().mockResolvedValue({}),
        } as any;
        const resilient = new ParticipationService(
          mockFormRepo,
          mockDemographicRepo,
          mockParticipationRepo,
          mockRewardSettlementCoordinator,
          mockCompletionCodeService,
          starter,
          undefined,
          undefined,
          undefined,
          logger,
        );

        const result = await resilient.submitInternalResponse(
          responseId,
          userId,
          { answers: { 'block-q1': 'Awesome experience' } },
        );

        expect(result.status).toBe('VALIDATED');
        expect(result.reward).toBeNull();
        expect(
          mockParticipationRepo.submitInternalResponseTransaction,
        ).toHaveBeenCalledTimes(1);
        expect(starter.tryUnlockStarterPoints).toHaveBeenCalledWith(
          userId,
          'INTERNAL_SUBMISSION',
        );
        expect(logger.warn).toHaveBeenCalledTimes(1);
        // No Publisher balances in the log line.
        expect(logger.warn.mock.calls[0][0]).not.toMatch(/\b12\b/);
      });

      it('re-drives the settlement on the owner replay from the pinned request', async () => {
        setupMockSubmissionData({ responseStatus: 'VALIDATED' });
        mockParticipationRepo.findInternalRewardRequest.mockResolvedValue({
          publisherId: 'publisher-id-1',
          respondentId: userId,
          rewardAmount: 40, // pinned at submit time; the form now says 50
          policyMode: 'ADVISORY',
        });

        const result = await service.submitInternalResponse(
          responseId,
          userId,
          { answers: { 'block-q1': 'Awesome experience' } },
        );

        expect(
          mockRewardSettlementCoordinator.settleInternalReward,
        ).toHaveBeenCalledTimes(1);
        expect(
          mockRewardSettlementCoordinator.settleInternalReward,
        ).toHaveBeenCalledWith({
          responseId,
          publisherId: 'publisher-id-1',
          respondentId: userId,
          rewardPerResponse: 40,
          policyMode: 'ADVISORY',
        });
        expect(result.reward?.status).toBe('SETTLED');
        expect(result.policyMode).toBe('ADVISORY');
        expect(
          mockParticipationRepo.submitInternalResponseTransaction,
        ).not.toHaveBeenCalled();
      });

      it('returns the posted settlement on replay without settling again', async () => {
        setupMockSubmissionData({ responseStatus: 'VALIDATED' });
        mockParticipationRepo.findInternalRewardRequest.mockResolvedValue({
          publisherId: 'publisher-id-1',
          respondentId: userId,
          rewardAmount: 50,
          policyMode: 'SHADOW',
        });
        const posted = {
          status: 'SETTLED' as const,
          journalId: 'journal-posted',
          amount: 50,
          targetAccountClass: 'USER_AVAILABLE' as const,
          settledAt: new Date().toISOString(),
        };
        (
          mockRewardSettlementCoordinator.findInternalSettlement as jest.Mock
        ).mockResolvedValue(posted);

        const result = await service.submitInternalResponse(
          responseId,
          userId,
          { answers: { 'block-q1': 'Awesome experience' } },
        );

        expect(result.reward).toEqual(posted);
        expect(
          mockRewardSettlementCoordinator.settleInternalReward,
        ).not.toHaveBeenCalled();
      });

      it('keeps a failing re-drive non-fatal on replay', async () => {
        setupMockSubmissionData({ responseStatus: 'VALIDATED' });
        mockParticipationRepo.findInternalRewardRequest.mockRejectedValue(
          new Error('outbox unavailable'),
        );

        const result = await service.submitInternalResponse(
          responseId,
          userId,
          { answers: { 'block-q1': 'Awesome experience' } },
        );

        expect(result.status).toBe('VALIDATED');
        expect(result.reward).toBeNull();
      });
    });

    describe('decision E9-D2: REWARD_EARNED once per response, after the credit commits', () => {
      // A real ledger + notifications behind the real coordinator; the
      // publish command needs a UUID recipient.
      const earnerId = '99999999-9999-4999-8999-999999999999';
      const pinnedRequest = {
        publisherId: 'publisher-id-1',
        respondentId: earnerId,
        rewardAmount: 50,
        policyMode: 'SHADOW' as const,
      };
      let ledgerService: LedgerService;
      let notificationRepo: InMemoryNotificationRepository;
      let publishSpy: jest.SpyInstance;
      let earningService: ParticipationService;

      async function fundEscrow(amount: number, key: string): Promise<void> {
        const system = await ledgerService.getOrCreateAccount(
          null,
          'SYSTEM_ISSUANCE',
        );
        const escrow = await ledgerService.getOrCreateAccount(
          'publisher-id-1',
          'ESCROW',
        );
        await ledgerService.postJournal({
          idempotencyKey: key,
          entries: [
            { accountId: system.id, amount: -amount },
            { accountId: escrow.id, amount },
          ],
        });
      }

      function submit() {
        return earningService.submitInternalResponse(responseId, earnerId, {
          answers: { 'block-q1': 'Awesome experience' },
        });
      }

      function asReplay() {
        setupMockSubmissionData({
          responseStatus: 'VALIDATED',
          respondentId: earnerId,
        });
        mockParticipationRepo.findInternalRewardRequest.mockResolvedValue(
          pinnedRequest,
        );
      }

      function earnedNotices() {
        return notificationRepo
          .all()
          .filter((notice) => notice.type === 'REWARD_EARNED');
      }

      beforeEach(() => {
        ledgerService = new LedgerService(new InMemoryLedgerRepository());
        notificationRepo = new InMemoryNotificationRepository();
        const notifications = new NotificationsService(notificationRepo);
        publishSpy = jest.spyOn(notifications, 'publish');
        earningService = new ParticipationService(
          mockFormRepo,
          mockDemographicRepo,
          mockParticipationRepo,
          new RewardSettlementCoordinator(ledgerService, notifications),
          mockCompletionCodeService,
        );
        setupMockSubmissionData({ respondentId: earnerId });
      });

      it('publishes once after the submission and its credit commit, with the full reward', async () => {
        await fundEscrow(100, 'seed-escrow-e9-d2');

        const result = await submit();

        expect(result.reward).toMatchObject({ status: 'SETTLED', amount: 50 });
        expect(earnedNotices()).toEqual([
          expect.objectContaining({
            userId: earnerId,
            dedupeKey: `internal-reward:${responseId}`,
            isRead: false,
          }),
        ]);
        expect(earnedNotices()[0].message).toMatch(/^50 points/);
        expect(publishSpy).toHaveBeenCalledTimes(1);
        expect(
          mockParticipationRepo.submitInternalResponseTransaction.mock
            .invocationCallOrder[0],
        ).toBeLessThan(publishSpy.mock.invocationCallOrder[0]);
      });

      it('an idempotent replay returns the original credit and publishes nothing new', async () => {
        await fundEscrow(100, 'seed-escrow-e9-d2');
        const first = await submit();

        asReplay();
        const replay = await submit();
        const again = await submit();

        expect(replay.reward?.journalId).toBe(first.reward?.journalId);
        expect(again.reward?.journalId).toBe(first.reward?.journalId);
        expect(publishSpy).toHaveBeenCalledTimes(1);
        expect(earnedNotices()).toHaveLength(1);
      });

      it('a settlement that failed after the submission is announced once when the replay recovers it', async () => {
        // Escrow empty: the submission commits, the credit does not.
        const failed = await submit();
        expect(failed.reward).toBeNull();
        expect(earnedNotices()).toHaveLength(0);

        await fundEscrow(100, 'seed-escrow-e9-d2-late');
        asReplay();
        const recovered = await submit();
        await submit();

        expect(recovered.reward).toMatchObject({
          status: 'SETTLED',
          amount: 50,
        });
        expect(earnedNotices()).toEqual([
          expect.objectContaining({
            userId: earnerId,
            dedupeKey: `internal-reward:${responseId}`,
          }),
        ]);
      });

      it('the Admin re-drive announces a recovered credit once and nothing for a posted one', async () => {
        await submit(); // fails: no Escrow yet
        await fundEscrow(100, 'seed-escrow-e9-d2-admin');
        asReplay();

        const redriven = await earningService.redriveInternalReward(responseId);
        const posted = await earningService.redriveInternalReward(responseId);

        expect(redriven.reward).toMatchObject({
          status: 'SETTLED',
          amount: 50,
        });
        expect(posted.reward?.journalId).toBe(redriven.reward?.journalId);
        expect(publishSpy).toHaveBeenCalledTimes(1);
        expect(earnedNotices()).toHaveLength(1);
      });

      it('a guest submission publishes nothing', async () => {
        await fundEscrow(100, 'seed-escrow-e9-d2-guest');
        setupMockSubmissionData({ isGuest: true, respondentId: null });

        const result = await earningService.submitInternalResponse(
          responseId,
          null,
          { answers: { 'block-q1': 'Awesome experience' } },
        );

        expect(result.reward?.status).toBe('SKIPPED_GUEST');
        expect(publishSpy).not.toHaveBeenCalled();
      });
    });

    describe('Epic 7 review P5: the replay retries the starter unlock', () => {
      function serviceWith(starter: unknown) {
        return new ParticipationService(
          mockFormRepo,
          mockDemographicRepo,
          mockParticipationRepo,
          mockRewardSettlementCoordinator,
          mockCompletionCodeService,
          starter as StarterPointsCoordinator,
        );
      }

      it('re-checks the unlock on the owner replay after the first check failed', async () => {
        const starter = {
          tryUnlockStarterPoints: jest
            .fn()
            // tryUnlock swallows its own failure (Story 7.2)...
            .mockResolvedValueOnce({
              unlocked: false,
              reason: 'Starter points unlock check failed; it will be retried.',
            })
            // ...and the client retry is the later trigger that activates.
            .mockResolvedValueOnce({ unlocked: true, amount: 100 }),
        };
        const withStarter = serviceWith(starter);

        setupMockSubmissionData();
        await withStarter.submitInternalResponse(responseId, userId, {
          answers: { 'block-q1': 'Awesome experience' },
        });
        setupMockSubmissionData({ responseStatus: 'VALIDATED' });
        const replay = await withStarter.submitInternalResponse(
          responseId,
          userId,
          { answers: { 'block-q1': 'Awesome experience' } },
        );

        expect(replay.status).toBe('VALIDATED');
        expect(
          mockParticipationRepo.submitInternalResponseTransaction,
        ).toHaveBeenCalledTimes(1);
        expect(starter.tryUnlockStarterPoints).toHaveBeenCalledTimes(2);
        expect(starter.tryUnlockStarterPoints).toHaveBeenNthCalledWith(
          2,
          userId,
          'INTERNAL_SUBMISSION',
        );
        await expect(
          starter.tryUnlockStarterPoints.mock.results[1].value,
        ).resolves.toMatchObject({ unlocked: true });
      });

      it('does not re-check the unlock on a guest replay', async () => {
        const starter = { tryUnlockStarterPoints: jest.fn() };
        setupMockSubmissionData({
          responseStatus: 'VALIDATED',
          isGuest: true,
          respondentId: null,
        });

        const result = await serviceWith(starter).submitInternalResponse(
          responseId,
          null,
          { answers: { 'block-q1': 'Guest feedback' } },
        );

        expect(result.status).toBe('VALIDATED');
        expect(starter.tryUnlockStarterPoints).not.toHaveBeenCalled();
      });
    });

    describe('Epic 6 review P1: Admin re-drive of an Internal reward', () => {
      it('rejects an unknown response and one that was never submitted', async () => {
        mockParticipationRepo.findResponseById.mockResolvedValue(null);
        await expect(
          service.redriveInternalReward(responseId),
        ).rejects.toBeInstanceOf(ResponseNotFoundException);

        setupMockSubmissionData({ responseStatus: 'IN_PROGRESS' });
        await expect(
          service.redriveInternalReward(responseId),
        ).rejects.toBeInstanceOf(RewardNotSettleableException);
      });

      it('never pays a guest response', async () => {
        setupMockSubmissionData({
          responseStatus: 'VALIDATED',
          isGuest: true,
          respondentId: null,
        });

        const result = await service.redriveInternalReward(responseId);

        expect(result.reward?.status).toBe('SKIPPED_GUEST');
        expect(
          mockRewardSettlementCoordinator.settleInternalReward,
        ).not.toHaveBeenCalled();
      });

      it('refuses a response without a recorded reward request', async () => {
        setupMockSubmissionData({ responseStatus: 'VALIDATED' });

        await expect(
          service.redriveInternalReward(responseId),
        ).rejects.toBeInstanceOf(RewardNotSettleableException);
      });
    });

    it('should throw ResponseNotFoundException if response does not exist', async () => {
      mockParticipationRepo.findResponseById.mockResolvedValue(null);

      await expect(
        service.submitInternalResponse('non-existent-resp', userId, {
          answers: { 'block-q1': 'text' },
        }),
      ).rejects.toThrow(ResponseNotFoundException);
    });

    it('should throw ParticipantNotEligibleException if caller does not own the response', async () => {
      setupMockSubmissionData({
        respondentId: 'different-user-id',
      });

      await expect(
        service.submitInternalResponse(
          responseId,
          userId, // mismatch
          { answers: { 'block-q1': 'text' } },
        ),
      ).rejects.toThrow(ParticipantNotEligibleException);
    });

    it('should throw AttemptExpiredException if attempt was abandoned', async () => {
      setupMockSubmissionData({
        attemptStatus: 'ABANDONED',
      });

      await expect(
        service.submitInternalResponse(responseId, userId, {
          answers: { 'block-q1': 'text' },
        }),
      ).rejects.toThrow(AttemptExpiredException);
    });

    it('should throw AttemptExpiredException if reservation window has elapsed', async () => {
      setupMockSubmissionData({
        attemptStartedAt: new Date(Date.now() - 40 * 60 * 1000), // 40 mins ago
      });

      await expect(
        service.submitInternalResponse(responseId, userId, {
          answers: { 'block-q1': 'text' },
        }),
      ).rejects.toThrow(AttemptExpiredException);
    });

    it('should throw InvalidFormSubmissionException if required question is missing', async () => {
      setupMockSubmissionData();

      await expect(
        service.submitInternalResponse(responseId, userId, {
          answers: {}, // missing required block-q1
        }),
      ).rejects.toThrow(InvalidFormSubmissionException);
    });

    it('should throw InvalidFormSubmissionException if answer violates block constraints', async () => {
      setupMockSubmissionData();

      await expect(
        service.submitInternalResponse(responseId, userId, {
          answers: { 'block-q1': 'ab' }, // minLength is 3
        }),
      ).rejects.toThrow(InvalidFormSubmissionException);
    });

    it('should throw SubmissionTooFastException when submitted faster than minTimeBarrierSeconds', async () => {
      setupMockSubmissionData({
        minTimeBarrierSeconds: 30,
        attemptStartedAt: new Date(Date.now() - 5000), // 5 seconds ago (< 30s)
      });

      await expect(
        service.submitInternalResponse(responseId, userId, {
          answers: { 'block-q1': 'Awesome experience' },
        }),
      ).rejects.toThrow(SubmissionTooFastException);
    });
  });

  describe('verifyExternalCompletionCode', () => {
    const attemptId = 'attempt-ext-1';
    const completionCode = '123456';

    function setupMockExternalAttempt(overrides?: {
      attemptStatus?: 'IN_PROGRESS' | 'COMPLETED' | 'LOCKED' | 'ABANDONED';
      startedAt?: Date;
      respondentId?: string;
      surveyType?: 'EXTERNAL' | 'INTERNAL';
      storedCompletionCode?: string;
      minTimeBarrierSeconds?: number;
      formStatus?: 'PUBLISHED' | 'CLOSED' | 'DRAFT';
    }) {
      const form = new FormEntity(
        formId,
        'publisher-uuid-1',
        overrides?.surveyType ?? 'EXTERNAL',
        overrides?.formStatus ?? 'PUBLISHED',
        'External Google Form',
        'Description',
        50,
        10,
        new Date(),
        new Date(),
      );

      const currentVersion = new FormVersionEntity(
        formVersionId,
        formId,
        1,
        {
          title: 'External Google Form',
          blocks: [],
          metadata: {
            expectedEffortSeconds: 60,
            minTimeBarrierSeconds: overrides?.minTimeBarrierSeconds ?? 15,
          },
        } as any,
        null,
        true,
        'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
        overrides?.storedCompletionCode ?? 'v1:valid_verifier_digest',
        new Date(),
        new Date(),
      );

      mockFormRepo.findById.mockResolvedValue({ form, currentVersion });

      const attempt = new SurveyAttemptEntity(
        attemptId,
        formId,
        formVersionId,
        overrides?.respondentId ?? userId,
        overrides?.attemptStatus ?? 'IN_PROGRESS',
        false,
        overrides?.startedAt ?? new Date(Date.now() - 30000), // 30s ago (> 15s)
        overrides?.attemptStatus === 'COMPLETED' ? new Date() : null,
        null,
        new Date(),
        new Date(),
      );

      mockParticipationRepo.findAttemptById.mockResolvedValue(attempt);
      // Epic 5 review P6: the locked re-read inside the Unit of Work.
      mockParticipationRepo.lockAttemptForVerification.mockResolvedValue(
        attempt,
      );
      mockParticipationRepo.completeExternalAttemptTransaction.mockResolvedValue(
        { outcome: 'COMPLETED', attempt },
      );

      return { form, currentVersion, attempt };
    }

    it('should successfully verify external completion code, complete attempt, and settle pending reward', async () => {
      const { form, currentVersion } = setupMockExternalAttempt();
      mockCompletionCodeService.verifyCode.mockReturnValue(true);

      const result = await service.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode },
      );

      expect(result.status).toBe('COMPLETED');
      expect(result.attemptId).toBe(attemptId);
      expect(result.formId).toBe(formId);
      expect(result.formVersionId).toBe(currentVersion.id);
      expect(result.reward?.status).toBe('PENDING');
      expect(result.reward?.amount).toBe(form.rewardPerResponse);

      expect(
        mockParticipationRepo.completeExternalAttemptTransaction,
      ).toHaveBeenCalledWith({
        attemptId,
        respondentId: userId,
        formId,
        formVersionId,
        submittedAt: expect.any(Date),
      });

      expect(
        mockRewardSettlementCoordinator.settleExternalReward,
      ).toHaveBeenCalledWith({
        attemptId,
        publisherId: form.publisherId,
        respondentId: userId,
        rewardPerResponse: form.rewardPerResponse,
      });
    });

    it('runs the non-fatal starter points unlock check after verification (Story 7.2)', async () => {
      setupMockExternalAttempt();
      mockCompletionCodeService.verifyCode.mockReturnValue(true);
      const logger = { warn: jest.fn() };
      const failingCoordinator = new StarterPointsCoordinator(
        {
          findJournalByIdempotencyKey: jest
            .fn()
            .mockRejectedValue(new Error('ledger down')),
        } as any,
        {} as any,
        undefined,
        logger,
      );
      const trySpy = jest.spyOn(failingCoordinator, 'tryUnlockStarterPoints');
      const serviceWithStarter = new ParticipationService(
        mockFormRepo,
        mockDemographicRepo,
        mockParticipationRepo,
        mockRewardSettlementCoordinator,
        mockCompletionCodeService,
        failingCoordinator,
      );

      const result = await serviceWithStarter.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode },
      );

      expect(result.status).toBe('COMPLETED');
      expect(trySpy).toHaveBeenCalledWith(userId, 'EXTERNAL_VERIFICATION');
      // Epic 6 review P10: the self-healing starter grant check logs its own
      // (non-fatal) failure before the unlock check does.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unlock check failed'),
      );
    });

    it('should return idempotent success when attempt is already COMPLETED', async () => {
      setupMockExternalAttempt({ attemptStatus: 'COMPLETED' });

      const result = await service.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode },
      );

      expect(result.status).toBe('COMPLETED');
      expect(
        mockParticipationRepo.completeExternalAttemptTransaction,
      ).not.toHaveBeenCalled();
    });

    it('returns the posted credit on replay without re-pricing it (Epic 6 review P5/P8)', async () => {
      setupMockExternalAttempt({ attemptStatus: 'COMPLETED' });
      const posted = {
        status: 'PENDING' as const,
        journalId: 'journal-original',
        amount: 30,
        targetAccountClass: 'PENDING' as const,
        settledAt: new Date().toISOString(),
      };
      (
        mockRewardSettlementCoordinator.findExternalSettlement as jest.Mock
      ).mockResolvedValue(posted);

      const result = await service.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode },
      );

      expect(result.reward).toEqual(posted);
      expect(
        mockRewardSettlementCoordinator.settleExternalReward,
      ).not.toHaveBeenCalled();
    });

    it('re-checks the starter unlock once on a COMPLETED replay (Epic 7 review P5)', async () => {
      setupMockExternalAttempt({ attemptStatus: 'COMPLETED' });
      const starter = {
        tryUnlockStarterPoints: jest
          .fn()
          .mockResolvedValue({ unlocked: false }),
      };
      const withStarter = new ParticipationService(
        mockFormRepo,
        mockDemographicRepo,
        mockParticipationRepo,
        mockRewardSettlementCoordinator,
        mockCompletionCodeService,
        starter as unknown as StarterPointsCoordinator,
      );

      const result = await withStarter.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode },
      );

      expect(result.status).toBe('COMPLETED');
      expect(
        mockParticipationRepo.completeExternalAttemptTransaction,
      ).not.toHaveBeenCalled();
      expect(starter.tryUnlockStarterPoints).toHaveBeenCalledTimes(1);
      expect(starter.tryUnlockStarterPoints).toHaveBeenCalledWith(
        userId,
        'EXTERNAL_VERIFICATION',
      );
    });

    it('still replays an already COMPLETED attempt after the survey closed (Epic 6 review P6)', async () => {
      setupMockExternalAttempt({
        attemptStatus: 'COMPLETED',
        formStatus: 'CLOSED',
      });

      const result = await service.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode },
      );

      expect(result.status).toBe('COMPLETED');
    });

    it('rejects a new completion on a closed survey before checking the code (Epic 6 review P6)', async () => {
      setupMockExternalAttempt({ formStatus: 'CLOSED' });

      await expect(
        service.verifyExternalCompletionCode(formId, attemptId, userId, {
          completionCode,
        }),
      ).rejects.toBeInstanceOf(SurveyNotAvailableException);
      expect(mockCompletionCodeService.verifyCode).not.toHaveBeenCalled();
      expect(
        mockParticipationRepo.recordFailedAttemptVerification,
      ).not.toHaveBeenCalled();
      expect(
        mockParticipationRepo.completeExternalAttemptTransaction,
      ).not.toHaveBeenCalled();
      expect(
        mockRewardSettlementCoordinator.settleExternalReward,
      ).not.toHaveBeenCalled();
    });

    it('rejects a completion that lost the race with a close inside the transaction (Epic 6 review P6)', async () => {
      const { attempt } = setupMockExternalAttempt();
      mockParticipationRepo.completeExternalAttemptTransaction.mockResolvedValue(
        { outcome: 'FORM_NOT_OPEN', attempt },
      );

      await expect(
        service.verifyExternalCompletionCode(formId, attemptId, userId, {
          completionCode,
        }),
      ).rejects.toBeInstanceOf(SurveyNotAvailableException);
      expect(
        mockRewardSettlementCoordinator.settleExternalReward,
      ).not.toHaveBeenCalled();
    });

    it('reports an Escrow shortfall without the Publisher balances (Epic 6 review P11)', async () => {
      setupMockExternalAttempt();
      (
        mockRewardSettlementCoordinator.settleExternalReward as jest.Mock
      ).mockRejectedValue(new InsufficientEscrowBalanceException(7, 50));

      const error = await service
        .verifyExternalCompletionCode(formId, attemptId, userId, {
          completionCode,
        })
        .catch((e) => e);

      expect(error).toBeInstanceOf(SurveyRewardUnavailableException);
      expect(error.message).not.toMatch(/\b7\b/);
      expect((error as any).availableBalance).toBeUndefined();
    });

    describe('Epic 6 review P1: Admin re-drive of an External credit', () => {
      it('settles a completed External attempt from the form and the attempt, never from input', async () => {
        setupMockExternalAttempt({ attemptStatus: 'COMPLETED' });

        const reward = await service.redriveExternalReward(attemptId);

        expect(reward?.status).toBe('PENDING');
        expect(
          mockRewardSettlementCoordinator.settleExternalReward,
        ).toHaveBeenCalledWith({
          attemptId,
          publisherId: 'publisher-uuid-1',
          respondentId: userId,
          rewardPerResponse: 50,
        });
      });

      it('rejects an attempt that is not completed, unknown, or Internal', async () => {
        setupMockExternalAttempt({ attemptStatus: 'IN_PROGRESS' });
        await expect(
          service.redriveExternalReward(attemptId),
        ).rejects.toBeInstanceOf(RewardNotSettleableException);

        mockParticipationRepo.findAttemptById.mockResolvedValue(null);
        await expect(
          service.redriveExternalReward(attemptId),
        ).rejects.toBeInstanceOf(SurveyNotAvailableException);

        setupMockExternalAttempt({
          attemptStatus: 'COMPLETED',
          surveyType: 'INTERNAL',
        });
        await expect(
          service.redriveExternalReward(attemptId),
        ).rejects.toBeInstanceOf(AttemptNotExternalException);
        expect(
          mockRewardSettlementCoordinator.settleExternalReward,
        ).not.toHaveBeenCalled();
      });
    });

    it('should throw AttemptLockedException if attempt is already LOCKED', async () => {
      setupMockExternalAttempt({ attemptStatus: 'LOCKED' });

      await expect(
        service.verifyExternalCompletionCode(formId, attemptId, userId, {
          completionCode,
        }),
      ).rejects.toThrow(AttemptLockedException);
    });

    it('should throw ParticipantNotEligibleException if caller does not own attempt', async () => {
      setupMockExternalAttempt({ respondentId: 'other-user-uuid' });

      await expect(
        service.verifyExternalCompletionCode(formId, attemptId, userId, {
          completionCode,
        }),
      ).rejects.toThrow(ParticipantNotEligibleException);
    });

    it('should throw AttemptNotExternalException if survey is INTERNAL', async () => {
      setupMockExternalAttempt({ surveyType: 'INTERNAL' });

      await expect(
        service.verifyExternalCompletionCode(formId, attemptId, userId, {
          completionCode,
        }),
      ).rejects.toThrow(AttemptNotExternalException);
    });

    it('should throw SubmissionTooFastException and log TIME_BARRIER if submitted before time barrier', async () => {
      setupMockExternalAttempt({
        minTimeBarrierSeconds: 20,
        startedAt: new Date(Date.now() - 5000), // only 5 seconds ago
      });

      await expect(
        service.verifyExternalCompletionCode(formId, attemptId, userId, {
          completionCode,
        }),
      ).rejects.toThrow(SubmissionTooFastException);

      // Story 8.2: uniform evidence shape, one entry per attempt.
      expect(mockParticipationRepo.recordFraudLog).toHaveBeenCalledWith(
        userId,
        'TIME_BARRIER',
        expect.objectContaining({
          source: 'EXTERNAL_COMPLETION_CODE',
          attemptId,
          requiredSeconds: 20,
        }),
        `time-barrier:${attemptId}`,
      );
    });

    it('should reject invalid completion code and indicate remaining attempts (1st failure)', async () => {
      setupMockExternalAttempt();
      mockCompletionCodeService.verifyCode.mockReturnValue(false);
      mockParticipationRepo.recordFailedAttemptVerification.mockResolvedValue({
        failureCount: 1,
        isLocked: false,
        accountFailureCount: 1,
        attemptInProgress: true,
      });

      await expect(
        service.verifyExternalCompletionCode(formId, attemptId, userId, {
          completionCode: '999999',
        }),
      ).rejects.toThrow(InvalidCompletionCodeException);

      expect(
        mockParticipationRepo.recordFailedAttemptVerification,
      ).toHaveBeenCalledWith(attemptId, userId, formVersionId);
    });

    it('should lock attempt when 3rd failed completion code verification occurs', async () => {
      setupMockExternalAttempt();
      mockCompletionCodeService.verifyCode.mockReturnValue(false);
      mockParticipationRepo.recordFailedAttemptVerification.mockResolvedValue({
        failureCount: 3,
        isLocked: true,
        accountFailureCount: 3,
        attemptInProgress: true,
      });

      await expect(
        service.verifyExternalCompletionCode(formId, attemptId, userId, {
          completionCode: '999999',
        }),
      ).rejects.toThrow(AttemptLockedException);
    });

    describe('shared Unit of Work (AD-16)', () => {
      let unitOfWork: {
        keys: string[];
        active: boolean;
        run: <T>(key: string, work: () => Promise<T>) => Promise<T>;
      };
      let uowService: ParticipationService;

      beforeEach(() => {
        unitOfWork = {
          keys: [],
          active: false,
          async run<T>(key: string, work: () => Promise<T>): Promise<T> {
            this.keys.push(key);
            this.active = true;
            try {
              return await work();
            } finally {
              this.active = false;
            }
          },
        };
        uowService = new ParticipationService(
          mockFormRepo,
          mockDemographicRepo,
          mockParticipationRepo,
          mockRewardSettlementCoordinator,
          mockCompletionCodeService,
          undefined,
          unitOfWork,
        );
      });

      it('commits the completion claim and Pending credit inside one Unit of Work keyed by attempt', async () => {
        const { attempt } = setupMockExternalAttempt();
        mockCompletionCodeService.verifyCode.mockReturnValue(true);
        const seenInsideUnitOfWork: string[] = [];
        mockParticipationRepo.completeExternalAttemptTransaction.mockImplementation(
          async () => {
            if (unitOfWork.active) seenInsideUnitOfWork.push('claim');
            return { outcome: 'COMPLETED', attempt };
          },
        );
        (
          mockRewardSettlementCoordinator.settleExternalReward as jest.Mock
        ).mockImplementation(async () => {
          if (unitOfWork.active) seenInsideUnitOfWork.push('credit');
          return {
            status: 'PENDING',
            journalId: 'journal-1',
            amount: 50,
            targetAccountClass: 'PENDING',
            settledAt: new Date().toISOString(),
          };
        });

        await uowService.verifyExternalCompletionCode(
          formId,
          attemptId,
          userId,
          { completionCode },
        );

        expect(unitOfWork.keys).toEqual([`external-completion:${attemptId}`]);
        expect(seenInsideUnitOfWork).toEqual(['claim', 'credit']);
      });

      it('propagates a Pending credit failure out of the Unit of Work so the claim rolls back', async () => {
        setupMockExternalAttempt();
        mockCompletionCodeService.verifyCode.mockReturnValue(true);
        (
          mockRewardSettlementCoordinator.settleExternalReward as jest.Mock
        ).mockRejectedValue(new Error('escrow insufficient'));

        await expect(
          uowService.verifyExternalCompletionCode(formId, attemptId, userId, {
            completionCode,
          }),
        ).rejects.toThrow('escrow insufficient');
        expect(unitOfWork.keys).toEqual([`external-completion:${attemptId}`]);
      });

      it('throws AttemptLockedException without crediting when the attempt was locked concurrently', async () => {
        const { attempt } = setupMockExternalAttempt();
        mockCompletionCodeService.verifyCode.mockReturnValue(true);
        const lockedAttempt = new SurveyAttemptEntity(
          attempt.id,
          attempt.surveyId,
          attempt.formVersionId,
          attempt.respondentId,
          'LOCKED',
          false,
          attempt.startedAt,
          null,
          null,
          attempt.createdAt,
          new Date(),
        );
        mockParticipationRepo.completeExternalAttemptTransaction.mockResolvedValue(
          { outcome: 'NOT_CLAIMABLE', attempt: lockedAttempt },
        );

        await expect(
          uowService.verifyExternalCompletionCode(formId, attemptId, userId, {
            completionCode,
          }),
        ).rejects.toThrow(AttemptLockedException);
        expect(
          mockRewardSettlementCoordinator.settleExternalReward,
        ).not.toHaveBeenCalled();
      });

      it('returns the original completion time when a concurrent request claimed the attempt first', async () => {
        const { attempt } = setupMockExternalAttempt();
        mockCompletionCodeService.verifyCode.mockReturnValue(true);
        const originalSubmittedAt = new Date(Date.now() - 1000);
        const completedAttempt = new SurveyAttemptEntity(
          attempt.id,
          attempt.surveyId,
          attempt.formVersionId,
          attempt.respondentId,
          'COMPLETED',
          false,
          attempt.startedAt,
          originalSubmittedAt,
          null,
          attempt.createdAt,
          new Date(),
        );
        mockParticipationRepo.completeExternalAttemptTransaction.mockResolvedValue(
          { outcome: 'ALREADY_COMPLETED', attempt: completedAttempt },
        );

        const result = await uowService.verifyExternalCompletionCode(
          formId,
          attemptId,
          userId,
          { completionCode },
        );

        expect(result.completedAt).toBe(originalSubmittedAt.toISOString());
        // Epic 5 review P19: the replay reads the winner's journal, never posts.
        expect(
          mockRewardSettlementCoordinator.settleExternalReward,
        ).not.toHaveBeenCalled();
        expect(
          mockRewardSettlementCoordinator.findExternalSettlement,
        ).toHaveBeenCalledWith(attemptId);
      });
    });
  });

  describe('Story 9.6: pending credit notification', () => {
    const attemptId = 'attempt-ext-notify';
    let publisher: { publish: jest.Mock };
    let insideUnitOfWork: boolean;
    let notifyingService: ParticipationService;

    function setupExternalAttempt(
      status: 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS',
    ) {
      const form = new FormEntity(
        formId,
        'publisher-uuid-1',
        'EXTERNAL',
        'PUBLISHED',
        'External Google Form',
        'Description',
        50,
        10,
        new Date(),
        new Date(),
      );
      const currentVersion = new FormVersionEntity(
        formVersionId,
        formId,
        1,
        {
          title: 'External Google Form',
          blocks: [],
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
        } as any,
        null,
        true,
        'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
        'v1:valid_verifier_digest',
        new Date(),
        new Date(),
      );
      mockFormRepo.findById.mockResolvedValue({ form, currentVersion });
      const attempt = new SurveyAttemptEntity(
        attemptId,
        formId,
        formVersionId,
        userId,
        status,
        false,
        new Date(Date.now() - 30000),
        status === 'COMPLETED' ? new Date() : null,
        null,
        new Date(),
        new Date(),
      );
      mockParticipationRepo.findAttemptById.mockResolvedValue(attempt);
      mockParticipationRepo.lockAttemptForVerification.mockResolvedValue(
        attempt,
      );
      mockParticipationRepo.completeExternalAttemptTransaction.mockResolvedValue(
        { outcome: 'COMPLETED', attempt },
      );
      mockCompletionCodeService.verifyCode.mockReturnValue(true);
    }

    beforeEach(() => {
      insideUnitOfWork = false;
      publisher = {
        publish: jest.fn(async () => {
          if (insideUnitOfWork) {
            throw new Error('published inside the source transaction');
          }
          return 'CREATED';
        }),
      };
      notifyingService = new ParticipationService(
        mockFormRepo,
        mockDemographicRepo,
        mockParticipationRepo,
        mockRewardSettlementCoordinator,
        mockCompletionCodeService,
        undefined,
        {
          async run<T>(_key: string, work: () => Promise<T>): Promise<T> {
            insideUnitOfWork = true;
            try {
              return await work();
            } finally {
              insideUnitOfWork = false;
            }
          },
        },
        publisher,
      );
    });

    it('notifies the respondent of the Pending credit after the completion commits', async () => {
      setupExternalAttempt();

      await notifyingService.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode: '123456' },
      );

      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.publish).toHaveBeenCalledWith({
        userId,
        type: 'REWARD_PENDING',
        message: expect.stringContaining('50'),
        dedupeKey: `external-completion:${attemptId}`,
      });
      await expect(publisher.publish.mock.results[0].value).resolves.toBe(
        'CREATED',
      );
    });

    function postedPendingCredit() {
      (
        mockRewardSettlementCoordinator.findExternalSettlement as jest.Mock
      ).mockResolvedValueOnce({
        status: 'PENDING',
        journalId: 'journal-uuid-ext-1',
        amount: 50,
        targetAccountClass: 'PENDING',
        settledAt: new Date().toISOString(),
      });
    }

    it('re-publishes with the same dedupe key on a replay while the credit is still PENDING (Epic 9 review P1)', async () => {
      setupExternalAttempt('COMPLETED');
      postedPendingCredit();

      await notifyingService.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode: '123456' },
      );

      expect(
        mockRewardSettlementCoordinator.getExternalCreditState,
      ).toHaveBeenCalledWith(attemptId);
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REWARD_PENDING',
          dedupeKey: `external-completion:${attemptId}`,
        }),
      );
    });

    it.each(['RELEASED', 'REVERSED', 'NONE'] as const)(
      'does not re-publish the pending notice on a replay when the credit is %s (Epic 9 review P1)',
      async (state) => {
        setupExternalAttempt('COMPLETED');
        postedPendingCredit();
        (
          mockRewardSettlementCoordinator.getExternalCreditState as jest.Mock
        ).mockResolvedValueOnce(state);

        const result = await notifyingService.verifyExternalCompletionCode(
          formId,
          attemptId,
          userId,
          { completionCode: '123456' },
        );

        expect(result.reward.amount).toBe(50);
        expect(publisher.publish).not.toHaveBeenCalled();
      },
    );

    it('still returns the replay result when the credit state lookup fails, without publishing (Epic 9 review P1)', async () => {
      setupExternalAttempt('COMPLETED');
      postedPendingCredit();
      (
        mockRewardSettlementCoordinator.getExternalCreditState as jest.Mock
      ).mockRejectedValueOnce(new Error('ledger unavailable'));
      const logger = { warn: jest.fn() };
      const withLogger = new ParticipationService(
        mockFormRepo,
        mockDemographicRepo,
        mockParticipationRepo,
        mockRewardSettlementCoordinator,
        mockCompletionCodeService,
        undefined,
        undefined,
        publisher,
        undefined,
        logger,
      );

      const result = await withLogger.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode: '123456' },
      );

      expect(result.status).toBe('COMPLETED');
      expect(result.reward).toEqual(
        expect.objectContaining({
          journalId: 'journal-uuid-ext-1',
          amount: 50,
        }),
      );
      expect(publisher.publish).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('ledger unavailable'),
      );
    });

    it('does not look up the credit state on a replay without a posted journal', async () => {
      setupExternalAttempt('COMPLETED');

      await notifyingService.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode: '123456' },
      );

      expect(
        mockRewardSettlementCoordinator.getExternalCreditState,
      ).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('does not notify when no Pending journal was posted (zero reward)', async () => {
      setupExternalAttempt();
      (
        mockRewardSettlementCoordinator.settleExternalReward as jest.Mock
      ).mockResolvedValueOnce({
        status: 'PENDING',
        journalId: null,
        amount: 0,
        targetAccountClass: null,
        settledAt: new Date().toISOString(),
      });

      await notifyingService.verifyExternalCompletionCode(
        formId,
        attemptId,
        userId,
        { completionCode: '123456' },
      );

      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('does not notify when the completion Unit of Work fails', async () => {
      setupExternalAttempt();
      (
        mockRewardSettlementCoordinator.settleExternalReward as jest.Mock
      ).mockRejectedValueOnce(new Error('escrow insufficient'));

      await expect(
        notifyingService.verifyExternalCompletionCode(
          formId,
          attemptId,
          userId,
          { completionCode: '123456' },
        ),
      ).rejects.toThrow('escrow insufficient');
      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('reportMissingCompletionCode', () => {
    const attemptId = 'attempt-ext-report-1';

    function mockExternalForm(type: 'EXTERNAL' | 'INTERNAL' = 'EXTERNAL') {
      mockFormRepo.findById.mockResolvedValue({
        form: new FormEntity(
          formId,
          'publisher-uuid-1',
          type,
          'PUBLISHED',
          'External Google Form',
          'Description',
          50,
          10,
          new Date(),
          new Date(),
        ),
        currentVersion: new FormVersionEntity(
          formVersionId,
          formId,
          1,
          {
            title: 'External Google Form',
            blocks: [],
            metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 20 },
          } as any,
          null,
          true,
          'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
          'v1:valid_verifier_digest',
          new Date(),
          new Date(),
        ),
      });
    }

    beforeEach(() => mockExternalForm());

    it('should successfully submit missing code report for an in-progress attempt', async () => {
      const attempt = new SurveyAttemptEntity(
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
      mockParticipationRepo.findAttemptById.mockResolvedValue(attempt);
      const reportedAt = new Date();
      mockParticipationRepo.reportMissingCompletionCode.mockResolvedValue({
        reportedAt,
      });

      const result = await service.reportMissingCompletionCode(
        formId,
        attemptId,
        userId,
        {
          reason:
            'Publisher did not include completion code on Google Form submit page',
        },
      );

      expect(result.status).toBe('REPORTED');
      expect(result.attemptId).toBe(attemptId);
      expect(result.reportedAt).toBe(reportedAt.toISOString());
      expect(
        mockParticipationRepo.reportMissingCompletionCode,
      ).toHaveBeenCalledWith(
        attemptId,
        userId,
        'Publisher did not include completion code on Google Form submit page',
        // Epic 5 review P20: timing evidence for the Admin.
        {
          startedAt: attempt.startedAt,
          elapsedSeconds: expect.any(Number),
          requiredBarrierSeconds: 20,
          reservationExpired: false,
        },
      );
    });

    it('rejects a report for an Internal survey attempt (Epic 5 review P20)', async () => {
      mockExternalForm('INTERNAL');
      mockParticipationRepo.findAttemptById.mockResolvedValue(
        new SurveyAttemptEntity(
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
        ),
      );

      await expect(
        service.reportMissingCompletionCode(formId, attemptId, userId, {
          reason: 'Some reason',
        }),
      ).rejects.toBeInstanceOf(AttemptNotExternalException);
      expect(
        mockParticipationRepo.reportMissingCompletionCode,
      ).not.toHaveBeenCalled();
    });

    it('still accepts a report after the reservation expired (the honest case), flagged as expired', async () => {
      const startedAt = new Date(Date.now() - 45 * 60 * 1000);
      mockParticipationRepo.findAttemptById.mockResolvedValue(
        new SurveyAttemptEntity(
          attemptId,
          formId,
          formVersionId,
          userId,
          'IN_PROGRESS',
          false,
          startedAt,
          null,
          null,
          new Date(),
          new Date(),
        ),
      );
      mockParticipationRepo.reportMissingCompletionCode.mockResolvedValue({
        reportedAt: new Date(),
      });

      await service.reportMissingCompletionCode(formId, attemptId, userId, {
        reason: 'The form never showed a code',
      });

      expect(
        mockParticipationRepo.reportMissingCompletionCode,
      ).toHaveBeenCalledWith(
        attemptId,
        userId,
        'The form never showed a code',
        expect.objectContaining({
          reservationExpired: true,
          elapsedSeconds: expect.any(Number),
        }),
      );
    });

    it('should throw AttemptLockedException if attempting to report on a locked attempt', async () => {
      const attempt = new SurveyAttemptEntity(
        attemptId,
        formId,
        formVersionId,
        userId,
        'LOCKED',
        false,
        new Date(),
        null,
        null,
        new Date(),
        new Date(),
      );
      mockParticipationRepo.findAttemptById.mockResolvedValue(attempt);

      await expect(
        service.reportMissingCompletionCode(formId, attemptId, userId, {
          reason: 'Some reason',
        }),
      ).rejects.toThrow(AttemptLockedException);
    });
  });

  describe('Story IR.2b deadline / plan 2.3 QUOTA close', () => {
    function form(
      over: {
        type?: 'INTERNAL' | 'EXTERNAL';
        status?: 'PUBLISHED' | 'CLOSED';
        closeKind?: 'QUOTA' | 'OWNER' | null;
        deadlineAt?: Date | null;
      } = {},
    ): FormWithVersion {
      const entity = new FormEntity(
        formId,
        'publisher-id',
        over.type ?? 'INTERNAL',
        over.status ?? 'PUBLISHED',
        'Survey',
        null,
        50,
        10,
        new Date(),
        new Date(),
        undefined,
        over.status === 'CLOSED' ? 1 : 0,
        null,
        over.closeKind ?? null,
        over.deadlineAt ?? null,
      );
      const version = new FormVersionEntity(
        formVersionId,
        formId,
        1,
        {
          title: 'S',
          blocks: [],
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
        } as any,
        null,
        true,
        over.type === 'EXTERNAL'
          ? 'https://docs.google.com/forms/d/e/x/viewform'
          : null,
        over.type === 'EXTERNAL' ? 'v1:valid_verifier_digest' : null,
        new Date(),
        new Date(),
      );
      return { form: entity, currentVersion: version, versions: [version] };
    }

    function attempt(
      status: 'IN_PROGRESS' | 'ABANDONED',
      closedReason: 'EXPIRED' | 'CANCELLED' | null = null,
    ): SurveyAttemptEntity {
      return new SurveyAttemptEntity(
        'attempt-ir2b',
        formId,
        formVersionId,
        userId,
        status,
        false,
        new Date(Date.now() - 40 * 60_000),
        null,
        null,
        new Date(),
        new Date(),
        undefined,
        closedReason,
        closedReason ? new Date() : null,
      );
    }

    it('a survey closed because its sample target was met answers SURVEY_QUOTA_FULL', async () => {
      mockFormRepo.findById.mockResolvedValue(
        form({ status: 'CLOSED', closeKind: 'QUOTA' }),
      );
      await expect(
        service.startAttempt(formId, userId, {}, clientIp),
      ).rejects.toBeInstanceOf(SurveyQuotaFullException);
      expect(mockParticipationRepo.reserveAttempt).not.toHaveBeenCalled();
    });

    it('refuses a new start at or after the deadline (SURVEY_NOT_AVAILABLE)', async () => {
      mockFormRepo.findById.mockResolvedValue(
        form({ deadlineAt: new Date(Date.now() - 1) }),
      );
      await expect(
        service.startAttempt(formId, userId, {}, clientIp),
      ).rejects.toBeInstanceOf(SurveyNotAvailableException);
      expect(mockParticipationRepo.reserveAttempt).not.toHaveBeenCalled();
    });

    it('Q5: accepts a missing-code report on an attempt the sweep closed as EXPIRED, not on a cancelled one', async () => {
      mockFormRepo.findById.mockResolvedValue(form({ type: 'EXTERNAL' }));
      mockParticipationRepo.reportMissingCompletionCode.mockResolvedValue({
        reportedAt: new Date(),
      });
      mockParticipationRepo.findAttemptById.mockResolvedValue(
        attempt('ABANDONED', 'EXPIRED'),
      );
      await expect(
        service.reportMissingCompletionCode(formId, 'attempt-ir2b', userId, {
          reason: 'No code was shown at the end of the form',
        }),
      ).resolves.toMatchObject({ status: 'REPORTED' });

      mockParticipationRepo.findAttemptById.mockResolvedValue(
        attempt('ABANDONED', 'CANCELLED'),
      );
      await expect(
        service.reportMissingCompletionCode(formId, 'attempt-ir2b', userId, {
          reason: 'No code was shown at the end of the form',
        }),
      ).rejects.toBeInstanceOf(AttemptExpiredException);
    });

    it('closes the survey (QUOTA) inside the completion-code verification Unit of Work', async () => {
      const quotaCloser = {
        closeFormIfQuotaMet: jest
          .fn()
          .mockResolvedValue({ closed: true, refundAmount: 0 }),
      };
      const withCloser = new ParticipationService(
        mockFormRepo,
        mockDemographicRepo,
        mockParticipationRepo,
        mockRewardSettlementCoordinator,
        mockCompletionCodeService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { quotaCloser },
      );
      const inProgress = new SurveyAttemptEntity(
        'attempt-ir2b',
        formId,
        formVersionId,
        userId,
        'IN_PROGRESS',
        false,
        new Date(Date.now() - 30_000),
        null,
        null,
        new Date(),
        new Date(),
      );
      mockFormRepo.findById.mockResolvedValue(form({ type: 'EXTERNAL' }));
      mockParticipationRepo.findAttemptById.mockResolvedValue(inProgress);
      mockParticipationRepo.lockAttemptForVerification.mockResolvedValue(
        inProgress,
      );
      mockParticipationRepo.completeExternalAttemptTransaction.mockResolvedValue(
        { outcome: 'COMPLETED', attempt: inProgress },
      );

      await withCloser.verifyExternalCompletionCode(
        formId,
        'attempt-ir2b',
        userId,
        { completionCode: '123456' },
      );

      expect(quotaCloser.closeFormIfQuotaMet).toHaveBeenCalledWith(
        formId,
        expect.any(Date),
      );
      // After this completion's own Pending credit drew its Escrow.
      expect(
        mockRewardSettlementCoordinator.settleExternalReward.mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        quotaCloser.closeFormIfQuotaMet.mock.invocationCallOrder[0],
      );
    });

    it('hands the QUOTA close to the Internal submit transaction (afterCompletion)', async () => {
      const quotaCloser = {
        closeFormIfQuotaMet: jest
          .fn()
          .mockResolvedValue({ closed: false, refundAmount: 0 }),
      };
      const withCloser = new ParticipationService(
        mockFormRepo,
        mockDemographicRepo,
        mockParticipationRepo,
        mockRewardSettlementCoordinator,
        mockCompletionCodeService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { quotaCloser },
      );
      const started = new Date(Date.now() - 60_000);
      const inProgress = new SurveyAttemptEntity(
        'attempt-ir2b',
        formId,
        formVersionId,
        userId,
        'IN_PROGRESS',
        false,
        started,
        null,
        null,
        new Date(),
        new Date(),
      );
      const response = new ResponseEntity(
        'response-ir2b',
        formId,
        formVersionId,
        'attempt-ir2b',
        userId,
        'IN_PROGRESS',
        null,
        clientIp,
        false,
        null,
        new Date(),
        new Date(),
      );
      mockFormRepo.findById.mockResolvedValue(form());
      mockParticipationRepo.findResponseById.mockResolvedValue(response);
      mockParticipationRepo.findAttemptById.mockResolvedValue(inProgress);
      mockParticipationRepo.submitInternalResponseTransaction.mockImplementation(
        async (params) => {
          await params.afterCompletion?.();
          return {
            outcome: 'SUBMITTED',
            response,
            attempt: inProgress,
            outboxEventIds: [],
          };
        },
      );

      await withCloser.submitInternalResponse('response-ir2b', userId, {
        answers: {},
      });

      expect(quotaCloser.closeFormIfQuotaMet).toHaveBeenCalledWith(
        formId,
        expect.any(Date),
      );
    });
  });
});
