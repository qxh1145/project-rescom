import { ParticipationController } from './participation.controller';
import { ParticipationService } from '../application/participation.service';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { SurveyAttemptResponseDto } from '@rescom/schemas';
import { Request } from 'express';
import { OptionalSessionCsrfGuard } from '../../auth/presentation/guards/optional-session-csrf.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';

describe('ParticipationController', () => {
  let controller: ParticipationController;
  let mockParticipationService: jest.Mocked<ParticipationService>;

  const formId = '11111111-1111-4111-8111-111111111111';
  const mockUser: AuthenticatedUser = {
    id: 'user-2222-2222-2222-222222222222',
    email: 'respondent@rescom.test',
    role: 'RESPONDENT',
    status: 'ACTIVE',
  };

  const mockReq = {
    ip: '192.168.1.1',
    socket: { remoteAddress: '192.168.1.1' },
  } as unknown as Request;

  beforeEach(() => {
    mockParticipationService = {
      startAttempt: jest.fn(),
    } as any;

    controller = new ParticipationController(mockParticipationService);
  });

  it('should initialize attempt via startFormAttempt and return success envelope', async () => {
    const expectedResponse: SurveyAttemptResponseDto = {
      attemptId: 'attempt-3333-3333-3333-333333333333',
      responseId: 'response-4444-4444-4444-444444444444',
      formId,
      formVersionId: 'version-5555-5555-5555-555555555555',
      type: 'INTERNAL',
      status: 'IN_PROGRESS',
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      externalUrl: null,
      storageCapability: 'a'.repeat(43),
    };

    mockParticipationService.startAttempt.mockResolvedValue(expectedResponse);

    const envelope = await controller.startFormAttempt(
      formId,
      mockUser,
      { clientContext: { platform: 'web' } },
      mockReq,
    );

    expect(mockParticipationService.startAttempt).toHaveBeenCalledWith(
      formId,
      mockUser.id,
      { clientContext: { platform: 'web' } },
      '192.168.1.1',
    );
    expect(envelope.data).toEqual(expectedResponse);
    expect(envelope.error).toBeNull();
  });

  it('should route surveys/:id/attempts to startFormAttempt alias', async () => {
    const expectedResponse: SurveyAttemptResponseDto = {
      attemptId: 'attempt-ext',
      responseId: null,
      formId,
      formVersionId: 'version-ext',
      type: 'EXTERNAL',
      status: 'IN_PROGRESS',
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      externalUrl: 'https://docs.google.com/forms/d/e/example',
      storageCapability: 'a'.repeat(43),
    };

    mockParticipationService.startAttempt.mockResolvedValue(expectedResponse);

    const envelope = await controller.startSurveyAttempt(
      formId,
      mockUser,
      {},
      mockReq,
    );

    expect(envelope.data).toEqual(expectedResponse);
  });

  it('should ingest telemetry events via ingestFormAttemptTelemetry', async () => {
    const attemptId = 'attempt-3333-3333-3333-333333333333';
    const payload = {
      events: [
        {
          clientEventId: 'evt-1111-1111-1111-111111111111',
          eventType: 'QUESTION_SHOWN' as const,
          attemptId,
          formVersionId: 'version-5555-5555-5555-555555555555',
          occurredAt: new Date().toISOString(),
        },
      ],
    };

    mockParticipationService.recordTelemetryEvents = jest
      .fn()
      .mockResolvedValue({
        success: true,
        ingestedCount: 1,
        attemptId,
      });

    const envelope = await controller.ingestFormAttemptTelemetry(
      formId,
      attemptId,
      payload,
      mockReq,
    );

    expect(mockParticipationService.recordTelemetryEvents).toHaveBeenCalledWith(
      formId,
      attemptId,
      null,
      payload,
      null,
    );
    expect(envelope.data).toEqual({
      success: true,
      ingestedCount: 1,
      attemptId,
    });
  });

  it('should ingest telemetry events via ingestResponseTelemetry', async () => {
    const responseId = 'response-4444-4444-4444-444444444444';
    const payload = {
      events: [
        {
          clientEventId: 'evt-1111-1111-1111-111111111111',
          eventType: 'ANSWER_SELECTED' as const,
          attemptId: 'attempt-3333-3333-3333-333333333333',
          formVersionId: 'version-5555-5555-5555-555555555555',
          occurredAt: new Date().toISOString(),
        },
      ],
    };

    mockParticipationService.recordResponseTelemetryEvents = jest
      .fn()
      .mockResolvedValue({
        success: true,
        ingestedCount: 1,
        attemptId: 'attempt-3333-3333-3333-333333333333',
      });

    const envelope = await controller.ingestResponseTelemetry(
      responseId,
      payload,
      mockReq,
    );

    expect(
      mockParticipationService.recordResponseTelemetryEvents,
    ).toHaveBeenCalledWith(responseId, null, payload, null);
    expect(envelope.data).toEqual({
      success: true,
      ingestedCount: 1,
      attemptId: 'attempt-3333-3333-3333-333333333333',
    });
  });

  it('should handle response submission via submitResponse', async () => {
    const responseId = 'response-4444-4444-4444-444444444444';
    const submissionResult = {
      responseId,
      attemptId: 'attempt-3333-3333-3333-333333333333',
      formId,
      formVersionId: 'version-5555-5555-5555-555555555555',
      status: 'VALIDATED' as const,
      submittedAt: new Date().toISOString(),
      reward: {
        status: 'SETTLED' as const,
        journalId: 'journal-uuid',
        amount: 50,
        targetAccountClass: 'USER_AVAILABLE' as const,
        settledAt: new Date().toISOString(),
      },
      policyMode: 'SHADOW' as const,
    };

    mockParticipationService.submitInternalResponse = jest
      .fn()
      .mockResolvedValue(submissionResult);

    const envelope = await controller.submitResponse(
      responseId,
      {
        answers: { 'q-1': 'Answer text' },
      },
      mockReq,
    );

    expect(
      mockParticipationService.submitInternalResponse,
    ).toHaveBeenCalledWith(
      responseId,
      null,
      { answers: { 'q-1': 'Answer text' } },
      true,
    );
    expect(envelope.data).toEqual(submissionResult);
    expect(envelope.error).toBeNull();
  });

  it('should handle form submission via submitForm and submitSurvey alias', async () => {
    const submissionResult = {
      responseId: 'response-4444-4444-4444-444444444444',
      attemptId: 'attempt-3333-3333-3333-333333333333',
      formId,
      formVersionId: 'version-5555-5555-5555-555555555555',
      status: 'VALIDATED' as const,
      submittedAt: new Date().toISOString(),
      reward: null,
      policyMode: 'SHADOW' as const,
    };

    mockParticipationService.submitInternalResponse = jest
      .fn()
      .mockResolvedValue(submissionResult);

    const envelope = await controller.submitForm(
      formId,
      {
        attemptId: 'attempt-3333-3333-3333-333333333333',
        answers: { 'q-1': 'Answer text' },
      },
      mockReq,
    );

    expect(
      mockParticipationService.submitInternalResponse,
    ).toHaveBeenCalledWith(
      formId,
      null,
      {
        attemptId: 'attempt-3333-3333-3333-333333333333',
        answers: { 'q-1': 'Answer text' },
      },
      false,
    );
    expect(envelope.data).toEqual(submissionResult);

    const surveyAliasEnvelope = await controller.submitSurvey(
      formId,
      {
        attemptId: 'attempt-3333-3333-3333-333333333333',
        answers: { 'q-1': 'Answer text' },
      },
      mockReq,
    );
    expect(surveyAliasEnvelope.data).toEqual(submissionResult);
  });

  it('should verify external completion code via verifyFormAttemptCode, verifySurveyAttemptCode, and verifyAttemptCode', async () => {
    const attemptId = 'attempt-ext-123';
    const completionResult = {
      attemptId,
      formId,
      formVersionId: 'version-5555-5555-5555-555555555555',
      status: 'COMPLETED' as const,
      completedAt: new Date().toISOString(),
      reward: {
        status: 'PENDING' as const,
        journalId: 'journal-uuid-1',
        amount: 50,
        targetAccountClass: 'PENDING' as any,
        settledAt: new Date().toISOString(),
      },
      message: 'Code verified successfully',
    };

    mockParticipationService.verifyExternalCompletionCode = jest
      .fn()
      .mockResolvedValue(completionResult);

    const formEnvelope = await controller.verifyFormAttemptCode(
      formId,
      attemptId,
      mockUser,
      { completionCode: '123456' },
    );
    expect(
      mockParticipationService.verifyExternalCompletionCode,
    ).toHaveBeenCalledWith(formId, attemptId, mockUser.id, {
      completionCode: '123456',
    });
    expect(formEnvelope.data).toEqual(completionResult);

    const surveyEnvelope = await controller.verifySurveyAttemptCode(
      formId,
      attemptId,
      mockUser,
      { completionCode: '123456' },
    );
    expect(surveyEnvelope.data).toEqual(completionResult);

    const directEnvelope = await controller.verifyAttemptCode(
      attemptId,
      mockUser,
      { completionCode: '123456' },
    );
    expect(
      mockParticipationService.verifyExternalCompletionCode,
    ).toHaveBeenCalledWith(null, attemptId, mockUser.id, {
      completionCode: '123456',
    });
    expect(directEnvelope.data).toEqual(completionResult);
  });

  it('should report missing code via reportFormAttemptMissingCode, reportSurveyAttemptMissingCode, and reportAttemptMissingCode', async () => {
    const attemptId = 'attempt-ext-123';
    const reportResult = {
      attemptId,
      reportedAt: new Date().toISOString(),
      status: 'REPORTED' as const,
      message: 'Report received',
    };

    mockParticipationService.reportMissingCompletionCode = jest
      .fn()
      .mockResolvedValue(reportResult);

    const formEnvelope = await controller.reportFormAttemptMissingCode(
      formId,
      attemptId,
      mockUser,
      { reason: 'Google Form did not show code' },
    );
    expect(
      mockParticipationService.reportMissingCompletionCode,
    ).toHaveBeenCalledWith(formId, attemptId, mockUser.id, {
      reason: 'Google Form did not show code',
    });
    expect(formEnvelope.data).toEqual(reportResult);

    const surveyEnvelope = await controller.reportSurveyAttemptMissingCode(
      formId,
      attemptId,
      mockUser,
      { reason: 'Google Form did not show code' },
    );
    expect(surveyEnvelope.data).toEqual(reportResult);

    const directEnvelope = await controller.reportAttemptMissingCode(
      attemptId,
      mockUser,
      { reason: 'Google Form did not show code' },
    );
    expect(
      mockParticipationService.reportMissingCompletionCode,
    ).toHaveBeenCalledWith(null, attemptId, mockUser.id, {
      reason: 'Google Form did not show code',
    });
    expect(directEnvelope.data).toEqual(reportResult);
  });

  describe('Epic 5 review P8/P12 wiring', () => {
    it('forwards the guest attempt capability header to telemetry ingestion', async () => {
      mockParticipationService.recordTelemetryEvents = jest
        .fn()
        .mockResolvedValue({
          success: true,
          ingestedCount: 0,
          attemptId: 'a',
        });
      const payload = { events: [] } as any;

      await controller.ingestFormAttemptTelemetry(
        formId,
        'attempt-1',
        payload,
        mockReq,
        'capability-token',
      );

      expect(
        mockParticipationService.recordTelemetryEvents,
      ).toHaveBeenCalledWith(
        formId,
        'attempt-1',
        null,
        payload,
        'capability-token',
      );
    });

    it.each(['submitResponse', 'submitForm', 'submitSurvey'] as const)(
      '%s requires the AD-20 CSRF check (session token, or Origin for a guest) and JSON',
      (handler) => {
        const guards: unknown[] = Reflect.getMetadata(
          '__guards__',
          ParticipationController.prototype[handler],
        );
        expect(guards).toEqual([OptionalSessionCsrfGuard, JsonOnlyGuard]);
      },
    );
  });
});
