import { ParticipationService } from './participation.service';
import {
  ParticipationRepositoryPort,
  LockedMissingCodeReport,
} from './ports/participation-repository.port';
import {
  FormRepositoryPort,
  FormWithVersion,
} from '../../forms/application/ports/form-repository.port';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';
import {
  AttemptNotExternalException,
  MissingCodeReportAlreadyResolvedException,
  MissingCodeReportNotFoundException,
  MissingCodeSelfResolveForbiddenException,
  MissingCodeSurveyClosedException,
  RewardNotSettleableException,
  SurveyAlreadyCompletedException,
  SurveyNotAvailableException,
  SurveyQuotaFullException,
  SurveyRewardUnavailableException,
} from './exceptions/participation.exceptions';
import { InsufficientBalanceException } from '../../economy/application/exceptions/economy.exceptions';
import { RewardSettlementCoordinator } from '../../economy/application/reward-settlement.coordinator';
import { StarterPointsCoordinator } from '../../economy/application/starter-points.coordinator';
import { SurveyQuotaClosePort } from './ports/survey-quota-close.port';
import {
  MISSING_CODE_AUDIT_EVENT_TYPE,
  MISSING_CODE_RESOLVED_EVENT_TYPE,
  missingCodeAuditKey,
  missingCodeResolvedEventKey,
} from '@rescom/schemas';

describe('ParticipationService.resolveMissingCodeReport (Story 14.1)', () => {
  let service: ParticipationService;
  let mockFormRepo: jest.Mocked<FormRepositoryPort>;
  let mockParticipationRepo: jest.Mocked<ParticipationRepositoryPort>;
  let mockRewardSettlementCoordinator: jest.Mocked<RewardSettlementCoordinator>;
  let mockStarterPointsCoordinator: jest.Mocked<StarterPointsCoordinator>;
  let mockQuotaCloser: jest.Mocked<SurveyQuotaClosePort>;

  const adminId = '11111111-1111-4111-8111-111111111111';
  const respondentId = '22222222-2222-4222-8222-222222222222';
  const publisherId = '33333333-3333-4333-8333-333333333333';
  const formId = '44444444-4444-4444-8444-444444444444';
  const formVersionId = '55555555-5555-4555-8555-555555555555';
  const attemptId = '66666666-6666-4666-8666-666666666666';

  function createMockFormWithVersion(overrides?: {
    status?: 'PUBLISHED' | 'CLOSED' | 'DRAFT';
    type?: 'INTERNAL' | 'EXTERNAL';
    rewardPerResponse?: number;
    expectedCompletions?: number;
  }): FormWithVersion {
    const form = new FormEntity(
      formId,
      publisherId,
      overrides?.type ?? 'EXTERNAL',
      overrides?.status ?? 'PUBLISHED',
      'Test External Survey',
      'Description',
      overrides?.rewardPerResponse ?? 50,
      overrides?.expectedCompletions ?? 10,
      new Date(),
      new Date(),
      undefined,
      0,
      null,
      null,
      null,
    );

    const currentVersion = new FormVersionEntity(
      formVersionId,
      formId,
      1,
      { title: 'Schema', blocks: [] } as any,
      null,
      true,
      'https://survey.example.com',
      null,
      new Date(),
      new Date(),
    );

    return { form, currentVersion };
  }

  function createAttempt(overrides?: {
    id?: string;
    surveyId?: string;
    formVersionId?: string;
    respondentId?: string | null;
    status?: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'LOCKED';
    isGuest?: boolean;
    startedAt?: Date;
    submittedAt?: Date | null;
    clientContext?: Record<string, unknown> | null;
    createdAt?: Date;
    updatedAt?: Date;
    missingCodeReportedAt?: Date | null;
    missingCodeReason?: string | null;
    closedReason?: 'EXPIRED' | 'CANCELLED' | null;
    closedAt?: Date | null;
    missingCodeResolvedAt?: Date | null;
    missingCodeResolution?: 'CREDIT_RESPONDENT' | 'DISMISSED' | null;
    missingCodeResolutionNote?: string | null;
    missingCodeResolvedById?: string | null;
  }): SurveyAttemptEntity {
    const reportedAt =
      overrides && 'missingCodeReportedAt' in overrides
        ? overrides.missingCodeReportedAt
        : new Date(Date.now() - 30000);

    return new SurveyAttemptEntity(
      overrides?.id ?? attemptId,
      overrides?.surveyId ?? formId,
      overrides?.formVersionId ?? formVersionId,
      'respondentId' in (overrides ?? {})
        ? (overrides?.respondentId ?? null)
        : respondentId,
      overrides?.status ?? 'IN_PROGRESS',
      overrides?.isGuest ?? false,
      overrides?.startedAt ?? new Date(Date.now() - 60000),
      overrides?.submittedAt ?? null,
      overrides?.clientContext ?? null,
      overrides?.createdAt ?? new Date(),
      overrides?.updatedAt ?? new Date(),
      {
        failedCount: 0,
        lastFailedAt: null,
        missingCodeReportedAt: reportedAt ?? null,
        missingCodeReason: overrides?.missingCodeReason ?? 'Did not receive code',
      },
      overrides?.closedReason ?? null,
      overrides?.closedAt ?? null,
      overrides?.missingCodeResolvedAt ?? null,
      overrides?.missingCodeResolution ?? null,
      overrides?.missingCodeResolutionNote ?? null,
      overrides?.missingCodeResolvedById ?? null,
    );
  }

  beforeEach(() => {
    mockFormRepo = {
      findById: jest.fn().mockResolvedValue(createMockFormWithVersion()),
    } as any;

    mockParticipationRepo = {
      findAttemptById: jest.fn().mockResolvedValue(createAttempt()),
      lockOpenMissingCodeReport: jest.fn().mockResolvedValue({
        attempt: createAttempt(),
        formOpen: true,
      } as LockedMissingCodeReport),
      getQuotaStatus: jest.fn().mockResolvedValue({
        completedCount: 2,
        activeReservationCount: 1,
      }),
      completeAttemptByAdmin: jest.fn().mockResolvedValue({ changed: true }),
      recordMissingCodeResolution: jest.fn().mockResolvedValue({ changed: true }),
    } as any;

    mockRewardSettlementCoordinator = {
      findExternalSettlement: jest.fn().mockResolvedValue(null),
      settleExternalReward: jest.fn().mockResolvedValue({
        status: 'PENDING',
        journalId: '77777777-7777-4777-8777-777777777777',
        amount: 50,
        targetAccountClass: 'PENDING',
        settledAt: new Date().toISOString(),
      }),
    } as any;

    mockStarterPointsCoordinator = {
      tryUnlockStarterPoints: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockQuotaCloser = {
      closeFormIfQuotaMet: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new ParticipationService(
      mockFormRepo,
      {} as any,
      mockParticipationRepo,
      mockRewardSettlementCoordinator,
      undefined,
      mockStarterPointsCoordinator,
      undefined,
      undefined,
      undefined,
      undefined,
      { quotaCloser: mockQuotaCloser },
    );
  });

  describe('Validation & Pre-checks', () => {
    it('throws validation error when note is too short', async () => {
      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'too short',
        }),
      ).rejects.toThrow();
    });

    it('throws MissingCodeReportNotFoundException if attempt does not exist', async () => {
      mockParticipationRepo.findAttemptById.mockResolvedValueOnce(null);

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(MissingCodeReportNotFoundException);
    });

    it('throws MissingCodeReportNotFoundException if attempt has no missingCodeReportedAt', async () => {
      mockParticipationRepo.findAttemptById.mockResolvedValueOnce(
        createAttempt({ missingCodeReportedAt: null }),
      );

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(MissingCodeReportNotFoundException);
    });

    it('throws MissingCodeSelfResolveForbiddenException if admin is the respondent', async () => {
      mockParticipationRepo.findAttemptById.mockResolvedValueOnce(
        createAttempt({ respondentId: adminId }),
      );

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(MissingCodeSelfResolveForbiddenException);
    });

    it('throws SurveyNotAvailableException if form does not exist', async () => {
      mockFormRepo.findById.mockResolvedValueOnce(null);

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(SurveyNotAvailableException);
    });

    it('throws AttemptNotExternalException if form is not EXTERNAL', async () => {
      mockFormRepo.findById.mockResolvedValueOnce(
        createMockFormWithVersion({ type: 'INTERNAL' }),
      );

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(AttemptNotExternalException);
    });
  });

  describe('Replay & Conflicts', () => {
    it('returns replayed: true when already resolved with the same outcome (CREDIT)', async () => {
      const resolvedAttempt = createAttempt({
        status: 'COMPLETED',
        missingCodeResolvedAt: new Date(),
        missingCodeResolution: 'CREDIT_RESPONDENT',
      });
      mockParticipationRepo.lockOpenMissingCodeReport.mockResolvedValueOnce({
        attempt: resolvedAttempt,
        formOpen: true,
      });

      const result = await service.resolveMissingCodeReport(adminId, attemptId, {
        outcome: 'CREDIT_RESPONDENT',
        note: 'Valid note for resolution here',
      });

      expect(result).toEqual({
        replayed: true,
        attemptId,
        outcome: 'CREDIT_RESPONDENT',
        attemptStatus: 'COMPLETED',
        rewardPoints: 50,
      });
      expect(mockParticipationRepo.completeAttemptByAdmin).not.toHaveBeenCalled();
      expect(mockParticipationRepo.recordMissingCodeResolution).not.toHaveBeenCalled();
    });

    it('returns replayed: true when already resolved with the same outcome (DISMISSED)', async () => {
      const resolvedAttempt = createAttempt({
        status: 'IN_PROGRESS',
        missingCodeResolvedAt: new Date(),
        missingCodeResolution: 'DISMISSED',
      });
      mockParticipationRepo.lockOpenMissingCodeReport.mockResolvedValueOnce({
        attempt: resolvedAttempt,
        formOpen: true,
      });

      const result = await service.resolveMissingCodeReport(adminId, attemptId, {
        outcome: 'DISMISSED',
        note: 'Valid note for resolution here',
      });

      expect(result).toEqual({
        replayed: true,
        attemptId,
        outcome: 'DISMISSED',
        attemptStatus: 'IN_PROGRESS',
        rewardPoints: null,
      });
    });

    it('throws MissingCodeReportAlreadyResolvedException when resolved with different outcome', async () => {
      const resolvedAttempt = createAttempt({
        status: 'COMPLETED',
        missingCodeResolvedAt: new Date(),
        missingCodeResolution: 'CREDIT_RESPONDENT',
      });
      mockParticipationRepo.lockOpenMissingCodeReport.mockResolvedValueOnce({
        attempt: resolvedAttempt,
        formOpen: true,
      });

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'DISMISSED',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(MissingCodeReportAlreadyResolvedException);
    });

    it('throws SurveyAlreadyCompletedException on CREDIT when attempt is COMPLETED without resolution', async () => {
      const completedAttempt = createAttempt({
        status: 'COMPLETED',
        missingCodeResolvedAt: null,
      });
      mockParticipationRepo.lockOpenMissingCodeReport.mockResolvedValueOnce({
        attempt: completedAttempt,
        formOpen: true,
      });

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(SurveyAlreadyCompletedException);
    });

    it('throws MissingCodeReportAlreadyResolvedException on DISMISSED when attempt is COMPLETED without resolution', async () => {
      const completedAttempt = createAttempt({
        status: 'COMPLETED',
        missingCodeResolvedAt: null,
      });
      mockParticipationRepo.lockOpenMissingCodeReport.mockResolvedValueOnce({
        attempt: completedAttempt,
        formOpen: true,
      });

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'DISMISSED',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(MissingCodeReportAlreadyResolvedException);
    });
  });

  describe('Outcome: CREDIT_RESPONDENT', () => {
    it('throws RewardNotSettleableException for guest attempt (no respondentId)', async () => {
      const guestAttempt = createAttempt({ respondentId: null });
      mockParticipationRepo.findAttemptById.mockResolvedValueOnce(guestAttempt);
      mockParticipationRepo.lockOpenMissingCodeReport.mockResolvedValueOnce({
        attempt: guestAttempt,
        formOpen: true,
      });

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(RewardNotSettleableException);
    });

    it('throws MissingCodeSurveyClosedException when form is closed', async () => {
      mockParticipationRepo.lockOpenMissingCodeReport.mockResolvedValueOnce({
        attempt: createAttempt(),
        formOpen: false,
      });

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(MissingCodeSurveyClosedException);
    });

    it('throws SurveyQuotaFullException when quota is reached excluding current attempt', async () => {
      mockParticipationRepo.getQuotaStatus.mockResolvedValueOnce({
        completedCount: 10,
        activeReservationCount: 0,
      });

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(SurveyQuotaFullException);

      expect(mockParticipationRepo.getQuotaStatus).toHaveBeenCalledWith(
        formId,
        expect.any(Date),
        attemptId,
      );
    });

    it('successfully credits respondent, posts pending reward, closes quota, records resolution, and unlocks starter points', async () => {
      const result = await service.resolveMissingCodeReport(adminId, attemptId, {
        outcome: 'CREDIT_RESPONDENT',
        note: 'Admin verified survey completion manually.',
      });

      expect(result).toEqual({
        replayed: false,
        attemptId,
        outcome: 'CREDIT_RESPONDENT',
        attemptStatus: 'COMPLETED',
        rewardPoints: 50,
      });

      expect(mockParticipationRepo.completeAttemptByAdmin).toHaveBeenCalledWith(
        attemptId,
        expect.any(Date),
      );
      expect(mockRewardSettlementCoordinator.settleExternalReward).toHaveBeenCalledWith({
        attemptId,
        publisherId,
        respondentId,
        rewardPerResponse: 50,
      });
      expect(mockQuotaCloser.closeFormIfQuotaMet).toHaveBeenCalledWith(
        formId,
        expect.any(Date),
      );

      expect(mockParticipationRepo.recordMissingCodeResolution).toHaveBeenCalledWith(
        attemptId,
        {
          resolution: 'CREDIT_RESPONDENT',
          note: 'Admin verified survey completion manually.',
          adminId,
          resolvedAt: expect.any(Date),
        },
        expect.objectContaining({
          idempotencyKey: missingCodeAuditKey(attemptId),
          eventType: MISSING_CODE_AUDIT_EVENT_TYPE,
          payload: expect.objectContaining({
            schemaVersion: 1,
            action: 'MISSING_CODE_REPORT_RESOLVED',
            adminId,
            attemptId,
            outcome: 'CREDIT_RESPONDENT',
            rewardPoints: 50,
            journalId: '77777777-7777-4777-8777-777777777777',
            noteLength: 42,
          }),
        }),
        expect.objectContaining({
          idempotencyKey: missingCodeResolvedEventKey(attemptId),
          eventType: MISSING_CODE_RESOLVED_EVENT_TYPE,
          payload: expect.objectContaining({
            schemaVersion: 1,
            attemptId,
            surveyId: formId,
            surveyTitle: 'Test External Survey',
            respondentId,
            publisherId,
            outcome: 'CREDIT_RESPONDENT',
            rewardPoints: 50,
            note: 'Admin verified survey completion manually.',
          }),
        }),
      );

      expect(mockStarterPointsCoordinator.tryUnlockStarterPoints).toHaveBeenCalledWith(
        respondentId,
        'EXTERNAL_VERIFICATION',
      );
    });

    it('maps InsufficientBalanceException to SurveyRewardUnavailableException', async () => {
      mockRewardSettlementCoordinator.settleExternalReward.mockRejectedValueOnce(
        new InsufficientBalanceException('Escrow empty'),
      );

      await expect(
        service.resolveMissingCodeReport(adminId, attemptId, {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Valid note for resolution here',
        }),
      ).rejects.toThrow(SurveyRewardUnavailableException);
    });
  });

  describe('Outcome: DISMISSED', () => {
    it('successfully dismisses report even on a closed survey and does not post reward or touch quota', async () => {
      mockParticipationRepo.lockOpenMissingCodeReport.mockResolvedValueOnce({
        attempt: createAttempt(),
        formOpen: false, // Closed survey is OK for DISMISSED
      });

      const result = await service.resolveMissingCodeReport(adminId, attemptId, {
        outcome: 'DISMISSED',
        note: 'Respondent did not provide proof of completion.',
      });

      expect(result).toEqual({
        replayed: false,
        attemptId,
        outcome: 'DISMISSED',
        attemptStatus: 'IN_PROGRESS',
        rewardPoints: null,
      });

      expect(mockParticipationRepo.completeAttemptByAdmin).not.toHaveBeenCalled();
      expect(mockRewardSettlementCoordinator.settleExternalReward).not.toHaveBeenCalled();
      expect(mockQuotaCloser.closeFormIfQuotaMet).not.toHaveBeenCalled();
      expect(mockStarterPointsCoordinator.tryUnlockStarterPoints).not.toHaveBeenCalled();

      expect(mockParticipationRepo.recordMissingCodeResolution).toHaveBeenCalledWith(
        attemptId,
        {
          resolution: 'DISMISSED',
          note: 'Respondent did not provide proof of completion.',
          adminId,
          resolvedAt: expect.any(Date),
        },
        expect.objectContaining({
          idempotencyKey: missingCodeAuditKey(attemptId),
          eventType: MISSING_CODE_AUDIT_EVENT_TYPE,
          payload: expect.objectContaining({
            outcome: 'DISMISSED',
            rewardPoints: null,
            journalId: null,
          }),
        }),
        expect.objectContaining({
          idempotencyKey: missingCodeResolvedEventKey(attemptId),
          eventType: MISSING_CODE_RESOLVED_EVENT_TYPE,
          payload: expect.objectContaining({
            outcome: 'DISMISSED',
            rewardPoints: null,
            note: 'Respondent did not provide proof of completion.',
          }),
        }),
      );
    });
  });
});
