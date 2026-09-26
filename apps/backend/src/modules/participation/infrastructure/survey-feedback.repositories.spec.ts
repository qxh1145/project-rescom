import { PrismaService } from '../../../common/database/prisma.service';
import { SurveyFeedbackEntity } from '../domain/survey-feedback.entity';
import { SurveyFeedbackSubmittedOutboxEvent } from '../application/ports/survey-feedback-repository.port';
import { InMemorySurveyFeedbackRepository } from './in-memory-survey-feedback.repository';
import { PrismaSurveyFeedbackRepository } from './prisma-survey-feedback.repository';

describe('Story 9.2: survey feedback repositories', () => {
  const submittedAt = new Date('2026-09-26T10:00:00.000Z');
  const feedback = new SurveyFeedbackEntity({
    id: '11111111-1111-4111-8111-111111111111',
    attemptId: '22222222-2222-4222-8222-222222222222',
    responseId: null,
    formId: '44444444-4444-4444-8444-444444444444',
    formVersionId: '55555555-5555-4555-8555-555555555555',
    respondentId: '66666666-6666-4666-8666-666666666666',
    formType: 'EXTERNAL',
    rating: 5,
    comment: 'Tốt',
    issueTags: ['TECHNICAL_ISSUE'],
    validationStatus: 'PENDING',
    validatedAt: null,
    submittedAt,
  });
  const event: SurveyFeedbackSubmittedOutboxEvent = {
    id: '77777777-7777-4777-8777-777777777777',
    idempotencyKey: `survey-feedback:${feedback.attemptId}`,
    eventType: 'SurveyFeedbackSubmitted',
    schemaVersion: 1,
    producer: 'participation-service',
    aggregateType: 'SurveyFeedback',
    aggregateId: feedback.id,
    payload: {
      schemaVersion: 1,
      feedbackId: feedback.id,
      attemptId: feedback.attemptId,
      responseId: null,
      formId: feedback.formId,
      formVersionId: feedback.formVersionId,
      formType: 'EXTERNAL',
      respondentId: feedback.respondentId,
      rating: 5,
      issueTags: ['TECHNICAL_ISSUE'],
      hasComment: true,
      validationStatus: 'PENDING',
      submittedAt: submittedAt.toISOString(),
    },
  };
  const row = {
    id: feedback.id,
    attemptId: feedback.attemptId,
    responseId: null,
    formId: feedback.formId,
    formVersionId: feedback.formVersionId,
    respondentId: feedback.respondentId,
    formType: 'EXTERNAL',
    rating: 5,
    comment: 'Tốt',
    issueTags: ['TECHNICAL_ISSUE'],
    validationStatus: 'PENDING',
    validatedAt: null,
    submittedAt,
    createdAt: submittedAt,
    updatedAt: submittedAt,
  };

  describe('InMemorySurveyFeedbackRepository', () => {
    it('stores one feedback per attempt and records its event', async () => {
      const repo = new InMemorySurveyFeedbackRepository();

      await expect(
        repo.createWithOutboxEvent(feedback, event),
      ).resolves.toEqual({ created: true, feedback });
      const duplicate = new SurveyFeedbackEntity({
        ...feedback,
        id: '88888888-8888-4888-8888-888888888888',
        rating: 1,
        comment: null,
      });
      await expect(
        repo.createWithOutboxEvent(duplicate, event),
      ).resolves.toEqual({ created: false, feedback });
      await expect(repo.findByAttemptId(feedback.attemptId)).resolves.toBe(
        feedback,
      );
      expect(repo.outboxEvents).toEqual([event]);
    });
  });

  describe('PrismaSurveyFeedbackRepository', () => {
    let tx: {
      surveyFeedback: { create: jest.Mock };
      outboxEvent: { create: jest.Mock };
    };
    let prisma: {
      $transaction: jest.Mock;
      surveyFeedback: { findUnique: jest.Mock };
    };
    let repo: PrismaSurveyFeedbackRepository;

    beforeEach(() => {
      tx = {
        surveyFeedback: { create: jest.fn().mockResolvedValue(row) },
        outboxEvent: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma = {
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
        surveyFeedback: { findUnique: jest.fn() },
      };
      repo = new PrismaSurveyFeedbackRepository(
        prisma as unknown as PrismaService,
      );
    });

    it('writes the feedback and its Outbox event in one transaction', async () => {
      const result = await repo.createWithOutboxEvent(feedback, event);

      expect(result.created).toBe(true);
      expect(result.feedback.toDto()).toEqual(feedback.toDto());
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.surveyFeedback.create).toHaveBeenCalledWith({
        data: {
          id: feedback.id,
          attemptId: feedback.attemptId,
          responseId: null,
          formId: feedback.formId,
          formVersionId: feedback.formVersionId,
          respondentId: feedback.respondentId,
          formType: 'EXTERNAL',
          rating: 5,
          comment: 'Tốt',
          issueTags: ['TECHNICAL_ISSUE'],
          validationStatus: 'PENDING',
          validatedAt: null,
          submittedAt,
        },
      });
      expect(tx.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: event.id,
          idempotencyKey: `survey-feedback:${feedback.attemptId}`,
          eventType: 'SurveyFeedbackSubmitted',
          producer: 'participation-service',
          aggregateType: 'SurveyFeedback',
          aggregateId: feedback.id,
          status: 'PENDING',
          payload: event.payload,
        }),
      });
    });

    it('returns the stored row with created=false on a unique attempt conflict', async () => {
      tx.surveyFeedback.create.mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );
      prisma.surveyFeedback.findUnique.mockResolvedValueOnce({
        ...row,
        rating: 3,
      });

      const result = await repo.createWithOutboxEvent(feedback, event);

      expect(result.created).toBe(false);
      expect(result.feedback.rating).toBe(3);
      expect(prisma.surveyFeedback.findUnique).toHaveBeenCalledWith({
        where: { attemptId: feedback.attemptId },
      });
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('rethrows other errors', async () => {
      tx.outboxEvent.create.mockRejectedValueOnce(new Error('db down'));
      await expect(repo.createWithOutboxEvent(feedback, event)).rejects.toThrow(
        'db down',
      );
    });

    it('maps rows found by attempt', async () => {
      prisma.surveyFeedback.findUnique.mockResolvedValueOnce(row);
      const found = await repo.findByAttemptId(feedback.attemptId);
      expect(found?.toDto()).toEqual(feedback.toDto());

      prisma.surveyFeedback.findUnique.mockResolvedValueOnce(null);
      await expect(repo.findByAttemptId('missing')).resolves.toBeNull();
    });
  });
});
