import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { HttpStatus } from '@nestjs/common';
import { SurveyFeedbackController } from './survey-feedback.controller';
import { SurveyFeedbackService } from '../application/survey-feedback.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';

describe('Story 9.2: SurveyFeedbackController', () => {
  let controller: SurveyFeedbackController;
  let service: jest.Mocked<
    Pick<SurveyFeedbackService, 'getFeedbackStatus' | 'submitFeedback'>
  >;

  const user = { id: '11111111-1111-4111-8111-111111111111' } as any;
  const attemptId = '22222222-2222-4222-8222-222222222222';
  const feedback = {
    id: '33333333-3333-4333-8333-333333333333',
    attemptId,
    formId: '44444444-4444-4444-8444-444444444444',
    formVersionId: '55555555-5555-4555-8555-555555555555',
    formType: 'EXTERNAL' as const,
    rating: 5,
    comment: null,
    issueTags: [],
    validationStatus: 'PENDING' as const,
    submittedAt: '2026-09-26T10:00:00.000Z',
  };

  beforeEach(async () => {
    service = {
      getFeedbackStatus: jest.fn(),
      submitFeedback: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SurveyFeedbackController],
      providers: [{ provide: SurveyFeedbackService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JsonOnlyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(SurveyFeedbackController);
  });

  it('returns the caller feedback status in a success envelope', async () => {
    const status = { attemptId, state: 'ELIGIBLE' as const, feedback: null };
    service.getFeedbackStatus.mockResolvedValue(status);

    await expect(controller.getStatus(attemptId, user)).resolves.toEqual({
      data: status,
      error: null,
      meta: {},
    });
    expect(service.getFeedbackStatus).toHaveBeenCalledWith(attemptId, user.id);
  });

  it('submits feedback on behalf of the caller only', async () => {
    const body = { rating: 5, comment: null, issueTags: [] };
    service.submitFeedback.mockResolvedValue({ feedback, replayed: false });

    await expect(controller.submit(attemptId, user, body)).resolves.toEqual({
      data: { feedback, replayed: false },
      error: null,
      meta: {},
    });
    expect(service.submitFeedback).toHaveBeenCalledWith(
      attemptId,
      user.id,
      body,
    );
  });

  it('guards the submission with CSRF + JSON-only and answers 200', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SurveyFeedbackController.prototype.submit,
    );
    expect(guards).toEqual([CsrfGuard, JsonOnlyGuard]);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        SurveyFeedbackController.prototype.submit,
      ),
    ).toBe(HttpStatus.OK);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SurveyFeedbackController),
    ).toEqual([SessionAuthGuard]);
  });
});
