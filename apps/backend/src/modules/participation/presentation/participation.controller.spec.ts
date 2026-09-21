import { ParticipationController } from './participation.controller';
import { ParticipationService } from '../application/participation.service';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { SurveyAttemptResponseDto } from '@rescom/schemas';
import { Request } from 'express';

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

    mockParticipationService.recordTelemetryEvents = jest.fn().mockResolvedValue({
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

    mockParticipationService.recordResponseTelemetryEvents = jest.fn().mockResolvedValue({
      success: true,
      ingestedCount: 1,
      attemptId: 'attempt-3333-3333-3333-333333333333',
    });

    const envelope = await controller.ingestResponseTelemetry(
      responseId,
      payload,
      mockReq,
    );

    expect(mockParticipationService.recordResponseTelemetryEvents).toHaveBeenCalledWith(
      responseId,
      null,
      payload,
    );
    expect(envelope.data).toEqual({
      success: true,
      ingestedCount: 1,
      attemptId: 'attempt-3333-3333-3333-333333333333',
    });
  });
});
