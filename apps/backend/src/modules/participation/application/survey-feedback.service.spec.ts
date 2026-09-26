import {
  submitSurveyFeedbackInputSchema,
  submitSurveyFeedbackResultSchema,
  surveyFeedbackStatusSchema,
  surveyFeedbackSubmittedEventPayloadSchema,
} from '@rescom/schemas';
import { SurveyFeedbackService } from './survey-feedback.service';
import {
  SurveyFeedbackAlreadySubmittedException,
  SurveyFeedbackAttemptNotFoundException,
  SurveyFeedbackNotAllowedException,
} from './exceptions/survey-feedback.exceptions';
import { InMemorySurveyFeedbackRepository } from '../infrastructure/in-memory-survey-feedback.repository';
import { InMemoryParticipationRepository } from '../infrastructure/in-memory-participation.repository';
import {
  AttemptStatus,
  SurveyAttemptEntity,
} from '../domain/survey-attempt.entity';
import { ResponseEntity, ResponseStatus } from '../domain/response.entity';
import { SurveyFeedbackEntity } from '../domain/survey-feedback.entity';
import { FormRepositoryPort } from '../../forms/application/ports/form-repository.port';

describe('Story 9.2: SurveyFeedbackService (FR-43)', () => {
  const respondentId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '99999999-9999-4999-8999-999999999999';
  const publisherUserId = '88888888-8888-4888-8888-888888888888';
  const internalFormId = '22222222-2222-4222-8222-222222222222';
  const externalFormId = '33333333-3333-4333-8333-333333333333';
  const formVersionId = '44444444-4444-4444-8444-444444444444';
  const attemptId = '55555555-5555-4555-8555-555555555555';
  const responseId = '66666666-6666-4666-8666-666666666666';
  const feedbackId = '77777777-7777-4777-8777-777777777777';
  const now = new Date('2026-09-26T10:00:00.000Z');

  let feedbackRepo: InMemorySurveyFeedbackRepository;
  let participationRepo: InMemoryParticipationRepository;
  let formRepository: { findById: jest.Mock };
  let service: SurveyFeedbackService;

  const command = (input: Record<string, unknown>) =>
    submitSurveyFeedbackInputSchema.parse(input);

  function seedAttempt(
    overrides: Partial<{
      id: string;
      surveyId: string;
      respondentId: string | null;
      status: AttemptStatus;
      isGuest: boolean;
    }> = {},
  ): SurveyAttemptEntity {
    const attempt = new SurveyAttemptEntity(
      overrides.id ?? attemptId,
      overrides.surveyId ?? internalFormId,
      formVersionId,
      overrides.respondentId === undefined
        ? respondentId
        : overrides.respondentId,
      overrides.status ?? 'COMPLETED',
      overrides.isGuest ?? false,
      new Date('2026-09-26T09:50:00.000Z'),
      new Date('2026-09-26T09:55:00.000Z'),
      null,
      new Date('2026-09-26T09:50:00.000Z'),
      new Date('2026-09-26T09:55:00.000Z'),
    );
    participationRepo.attempts.set(attempt.id, attempt);
    return attempt;
  }

  function seedResponse(
    status: ResponseStatus = 'VALIDATED',
    owner: string | null = respondentId,
  ): ResponseEntity {
    const response = new ResponseEntity(
      responseId,
      internalFormId,
      formVersionId,
      attemptId,
      owner,
      status,
      { q1: 'a' },
      '127.0.0.1',
      false,
      new Date('2026-09-26T09:55:00.000Z'),
      new Date('2026-09-26T09:50:00.000Z'),
      new Date('2026-09-26T09:55:00.000Z'),
    );
    participationRepo.responses.set(response.id, response);
    return response;
  }

  function mockForm(
    id: string,
    type: 'INTERNAL' | 'EXTERNAL',
    publisherId = publisherUserId,
  ) {
    return {
      id,
      type,
      publisherId,
      isOwnedBy: (userId: string) => userId === publisherId,
    };
  }

  beforeEach(() => {
    feedbackRepo = new InMemorySurveyFeedbackRepository();
    participationRepo = new InMemoryParticipationRepository();
    formRepository = {
      findById: jest.fn(async (id: string) => {
        if (id === internalFormId) return { form: mockForm(id, 'INTERNAL') };
        if (id === externalFormId) return { form: mockForm(id, 'EXTERNAL') };
        return null;
      }),
    };
    service = new SurveyFeedbackService({
      feedbackRepository: feedbackRepo,
      participationRepository: participationRepo,
      formRepository: formRepository as unknown as FormRepositoryPort,
      now: () => now,
      generateId: () => feedbackId,
    });
  });

  describe('submitFeedback', () => {
    it('stores Internal feedback linked to form, version, attempt and validated response with PENDING validation', async () => {
      seedAttempt();
      seedResponse('VALIDATED');

      const result = await service.submitFeedback(
        attemptId,
        respondentId,
        command({
          rating: 4,
          comment: '  Câu hỏi rõ ràng  ',
          issueTags: ['LONGER_THAN_ESTIMATED'],
        }),
      );

      expect(submitSurveyFeedbackResultSchema.parse(result)).toEqual({
        replayed: false,
        feedback: {
          id: feedbackId,
          attemptId,
          formId: internalFormId,
          formVersionId,
          formType: 'INTERNAL',
          rating: 4,
          comment: 'Câu hỏi rõ ràng',
          issueTags: ['LONGER_THAN_ESTIMATED'],
          validationStatus: 'PENDING',
          submittedAt: now.toISOString(),
        },
      });
      const stored = feedbackRepo.feedback.get(attemptId)!;
      expect(stored.responseId).toBe(responseId);
      expect(stored.respondentId).toBe(respondentId);
      // Publisher/owner DTO never exposes respondent identity.
      expect(JSON.stringify(result)).not.toContain(respondentId);
    });

    it('emits one SurveyFeedbackSubmitted Outbox event without comment text', async () => {
      seedAttempt();
      seedResponse('VALIDATED');

      await service.submitFeedback(
        attemptId,
        respondentId,
        command({ rating: 2, comment: 'Lỗi hiển thị' }),
      );

      expect(feedbackRepo.outboxEvents).toHaveLength(1);
      const [event] = feedbackRepo.outboxEvents;
      expect(event).toEqual(
        expect.objectContaining({
          idempotencyKey: `survey-feedback:${attemptId}`,
          eventType: 'SurveyFeedbackSubmitted',
          schemaVersion: 1,
          producer: 'participation-service',
          aggregateType: 'SurveyFeedback',
          aggregateId: feedbackId,
        }),
      );
      expect(
        surveyFeedbackSubmittedEventPayloadSchema.parse(event.payload),
      ).toEqual({
        schemaVersion: 1,
        feedbackId,
        attemptId,
        responseId,
        formId: internalFormId,
        formVersionId,
        formType: 'INTERNAL',
        respondentId,
        rating: 2,
        issueTags: [],
        hasComment: true,
        validationStatus: 'PENDING',
        submittedAt: now.toISOString(),
      });
      expect(JSON.stringify(event.payload)).not.toContain('Lỗi hiển thị');
    });

    it('accepts External feedback for a COMPLETED attempt without a Response', async () => {
      seedAttempt({ surveyId: externalFormId });

      const result = await service.submitFeedback(
        attemptId,
        respondentId,
        command({ rating: 5 }),
      );

      expect(result.feedback.formType).toBe('EXTERNAL');
      expect(result.feedback.comment).toBeNull();
      expect(feedbackRepo.feedback.get(attemptId)!.responseId).toBeNull();
      expect(feedbackRepo.outboxEvents[0].payload).toEqual(
        expect.objectContaining({ responseId: null, hasComment: false }),
      );
    });

    it.each(['IN_PROGRESS', 'ABANDONED', 'LOCKED'] as const)(
      'refuses an attempt in status %s',
      async (status) => {
        seedAttempt({ surveyId: externalFormId, status });

        await expect(
          service.submitFeedback(
            attemptId,
            respondentId,
            command({ rating: 3 }),
          ),
        ).rejects.toBeInstanceOf(SurveyFeedbackNotAllowedException);
        expect(feedbackRepo.all()).toHaveLength(0);
        expect(feedbackRepo.outboxEvents).toHaveLength(0);
      },
    );

    it.each(['IN_PROGRESS', 'SUBMITTED', 'DISPUTED', 'REJECTED'] as const)(
      'refuses an Internal attempt whose Response is %s',
      async (status) => {
        seedAttempt();
        seedResponse(status);

        await expect(
          service.submitFeedback(
            attemptId,
            respondentId,
            command({ rating: 3 }),
          ),
        ).rejects.toBeInstanceOf(SurveyFeedbackNotAllowedException);
      },
    );

    it('refuses an Internal attempt without a Response', async () => {
      seedAttempt();

      await expect(
        service.submitFeedback(attemptId, respondentId, command({ rating: 3 })),
      ).rejects.toBeInstanceOf(SurveyFeedbackNotAllowedException);
    });

    it('refuses an Internal Response owned by someone else', async () => {
      seedAttempt();
      seedResponse('VALIDATED', otherUserId);

      await expect(
        service.submitFeedback(attemptId, respondentId, command({ rating: 3 })),
      ).rejects.toBeInstanceOf(SurveyFeedbackNotAllowedException);
    });

    it('answers 404 for unknown, not-owned and guest attempts alike', async () => {
      await expect(
        service.submitFeedback(attemptId, respondentId, command({ rating: 3 })),
      ).rejects.toBeInstanceOf(SurveyFeedbackAttemptNotFoundException);

      seedAttempt({ surveyId: externalFormId });
      await expect(
        service.submitFeedback(attemptId, otherUserId, command({ rating: 3 })),
      ).rejects.toBeInstanceOf(SurveyFeedbackAttemptNotFoundException);

      seedAttempt({ respondentId: null, isGuest: true });
      await expect(
        service.submitFeedback(attemptId, respondentId, command({ rating: 3 })),
      ).rejects.toBeInstanceOf(SurveyFeedbackAttemptNotFoundException);
      expect(feedbackRepo.all()).toHaveLength(0);
    });

    it('answers 404 when the attempt form no longer exists', async () => {
      seedAttempt({ surveyId: '88888888-8888-4888-8888-888888888888' });

      await expect(
        service.submitFeedback(attemptId, respondentId, command({ rating: 3 })),
      ).rejects.toBeInstanceOf(SurveyFeedbackAttemptNotFoundException);
    });

    it('replays an identical submission without a second row or event', async () => {
      seedAttempt({ surveyId: externalFormId });
      const first = await service.submitFeedback(
        attemptId,
        respondentId,
        command({
          rating: 4,
          comment: 'Ổn',
          issueTags: ['TECHNICAL_ISSUE', 'UNCLEAR_QUESTIONS'],
        }),
      );

      const replay = await service.submitFeedback(
        attemptId,
        respondentId,
        command({
          rating: 4,
          comment: ' Ổn ',
          issueTags: ['UNCLEAR_QUESTIONS', 'TECHNICAL_ISSUE'],
        }),
      );

      expect(replay).toEqual({ feedback: first.feedback, replayed: true });
      expect(feedbackRepo.all()).toHaveLength(1);
      expect(feedbackRepo.outboxEvents).toHaveLength(1);
    });

    it('rejects a different second submission as a conflict and keeps the original', async () => {
      seedAttempt({ surveyId: externalFormId });
      await service.submitFeedback(
        attemptId,
        respondentId,
        command({ rating: 4 }),
      );

      await expect(
        service.submitFeedback(attemptId, respondentId, command({ rating: 1 })),
      ).rejects.toBeInstanceOf(SurveyFeedbackAlreadySubmittedException);
      expect(feedbackRepo.feedback.get(attemptId)!.rating).toBe(4);
      expect(feedbackRepo.outboxEvents).toHaveLength(1);
    });

    it('resolves a concurrent duplicate insert through the same replay/conflict rule', async () => {
      seedAttempt({ surveyId: externalFormId });
      const winner = new SurveyFeedbackEntity({
        id: '12121212-1212-4212-8212-121212121212',
        attemptId,
        responseId: null,
        formId: externalFormId,
        formVersionId,
        respondentId,
        formType: 'EXTERNAL',
        rating: 5,
        comment: null,
        issueTags: [],
        validationStatus: 'PENDING',
        validatedAt: null,
        submittedAt: now,
      });
      // The pre-check misses the row that a concurrent request commits first.
      jest.spyOn(feedbackRepo, 'findByAttemptId').mockResolvedValue(null);
      feedbackRepo.feedback.set(attemptId, winner);

      await expect(
        service.submitFeedback(attemptId, respondentId, command({ rating: 5 })),
      ).resolves.toEqual({ feedback: winner.toDto(), replayed: true });
      await expect(
        service.submitFeedback(attemptId, respondentId, command({ rating: 2 })),
      ).rejects.toBeInstanceOf(SurveyFeedbackAlreadySubmittedException);
      expect(feedbackRepo.outboxEvents).toHaveLength(0);
    });

    it('checks ownership before revealing an existing feedback', async () => {
      seedAttempt({ surveyId: externalFormId });
      await service.submitFeedback(
        attemptId,
        respondentId,
        command({ rating: 4 }),
      );

      await expect(
        service.submitFeedback(attemptId, otherUserId, command({ rating: 4 })),
      ).rejects.toBeInstanceOf(SurveyFeedbackAttemptNotFoundException);
    });
  });

  describe('Epic 9 review P2: publishers cannot rate their own survey', () => {
    it.each([
      ['Internal', internalFormId, 'INTERNAL'],
      ['External', externalFormId, 'EXTERNAL'],
    ] as const)(
      'refuses the publisher of an %s survey (NOT_ELIGIBLE, 409 on submit)',
      async (_label, formId, type) => {
        formRepository.findById.mockImplementation(async (id: string) =>
          id === formId ? { form: mockForm(id, type, respondentId) } : null,
        );
        seedAttempt({ surveyId: formId });
        if (type === 'INTERNAL') {
          seedResponse('VALIDATED');
        }

        await expect(
          service.getFeedbackStatus(attemptId, respondentId),
        ).resolves.toEqual({
          attemptId,
          state: 'NOT_ELIGIBLE',
          feedback: null,
        });
        await expect(
          service.submitFeedback(
            attemptId,
            respondentId,
            command({ rating: 5 }),
          ),
        ).rejects.toBeInstanceOf(SurveyFeedbackNotAllowedException);
        expect(feedbackRepo.all()).toHaveLength(0);
        expect(feedbackRepo.outboxEvents).toHaveLength(0);
      },
    );
  });

  describe('Epic 9 review P3: reversed External completion credits', () => {
    let externalCredits: { getExternalCreditState: jest.Mock };

    beforeEach(() => {
      externalCredits = { getExternalCreditState: jest.fn() };
      service = new SurveyFeedbackService({
        feedbackRepository: feedbackRepo,
        participationRepository: participationRepo,
        formRepository: formRepository as unknown as FormRepositoryPort,
        externalCredits,
        now: () => now,
        generateId: () => feedbackId,
      });
    });

    it('refuses feedback when the completion credit was REVERSED', async () => {
      externalCredits.getExternalCreditState.mockResolvedValue('REVERSED');
      seedAttempt({ surveyId: externalFormId });

      await expect(
        service.getFeedbackStatus(attemptId, respondentId),
      ).resolves.toEqual({ attemptId, state: 'NOT_ELIGIBLE', feedback: null });
      await expect(
        service.submitFeedback(attemptId, respondentId, command({ rating: 1 })),
      ).rejects.toBeInstanceOf(SurveyFeedbackNotAllowedException);
      expect(externalCredits.getExternalCreditState).toHaveBeenCalledWith(
        attemptId,
      );
      expect(feedbackRepo.all()).toHaveLength(0);
    });

    it.each(['PENDING', 'RELEASED', 'NONE'] as const)(
      'accepts feedback when the completion credit is %s',
      async (state) => {
        externalCredits.getExternalCreditState.mockResolvedValue(state);
        seedAttempt({ surveyId: externalFormId });

        await expect(
          service.getFeedbackStatus(attemptId, respondentId),
        ).resolves.toEqual(expect.objectContaining({ state: 'ELIGIBLE' }));
        const result = await service.submitFeedback(
          attemptId,
          respondentId,
          command({ rating: 4 }),
        );
        expect(result.replayed).toBe(false);
        expect(result.feedback.formType).toBe('EXTERNAL');
      },
    );

    it('never consults the credit state for Internal feedback', async () => {
      seedAttempt();
      seedResponse('VALIDATED');

      await service.submitFeedback(
        attemptId,
        respondentId,
        command({ rating: 4 }),
      );

      expect(externalCredits.getExternalCreditState).not.toHaveBeenCalled();
    });
  });

  describe('getFeedbackStatus', () => {
    it('is ELIGIBLE for a completed attempt without feedback', async () => {
      seedAttempt({ surveyId: externalFormId });

      const status = await service.getFeedbackStatus(attemptId, respondentId);

      expect(surveyFeedbackStatusSchema.parse(status)).toEqual({
        attemptId,
        state: 'ELIGIBLE',
        feedback: null,
      });
    });

    it('is SUBMITTED with the caller feedback after submission', async () => {
      seedAttempt();
      seedResponse('VALIDATED');
      const { feedback } = await service.submitFeedback(
        attemptId,
        respondentId,
        command({ rating: 3 }),
      );

      await expect(
        service.getFeedbackStatus(attemptId, respondentId),
      ).resolves.toEqual({ attemptId, state: 'SUBMITTED', feedback });
    });

    it('is NOT_ELIGIBLE for an unfinished attempt or unvalidated response', async () => {
      seedAttempt({ status: 'IN_PROGRESS' });
      await expect(
        service.getFeedbackStatus(attemptId, respondentId),
      ).resolves.toEqual({ attemptId, state: 'NOT_ELIGIBLE', feedback: null });

      seedAttempt();
      seedResponse('REJECTED');
      await expect(
        service.getFeedbackStatus(attemptId, respondentId),
      ).resolves.toEqual({ attemptId, state: 'NOT_ELIGIBLE', feedback: null });
    });

    it('answers 404 for another user attempt', async () => {
      seedAttempt({ surveyId: externalFormId });

      await expect(
        service.getFeedbackStatus(attemptId, otherUserId),
      ).rejects.toBeInstanceOf(SurveyFeedbackAttemptNotFoundException);
    });
  });
});
