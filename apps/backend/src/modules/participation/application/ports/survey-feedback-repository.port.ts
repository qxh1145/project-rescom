import type { SurveyFeedbackSubmittedEventPayload } from '@rescom/schemas';
import { SurveyFeedbackEntity } from '../../domain/survey-feedback.entity';

export const SURVEY_FEEDBACK_REPOSITORY_PORT = Symbol(
  'SURVEY_FEEDBACK_REPOSITORY_PORT',
);

/** AD-10 Outbox row committed together with the feedback. */
export interface SurveyFeedbackSubmittedOutboxEvent {
  id: string;
  /** `survey-feedback:{attemptId}` */
  idempotencyKey: string;
  eventType: 'SurveyFeedbackSubmitted';
  schemaVersion: 1;
  producer: 'participation-service';
  aggregateType: 'SurveyFeedback';
  aggregateId: string;
  payload: SurveyFeedbackSubmittedEventPayload;
}

export interface CreateSurveyFeedbackResult {
  /** false = a feedback for this attempt already existed (returned instead). */
  created: boolean;
  feedback: SurveyFeedbackEntity;
}

export interface SurveyFeedbackRepositoryPort {
  findByAttemptId(attemptId: string): Promise<SurveyFeedbackEntity | null>;

  /**
   * Inserts the feedback and its Outbox event atomically. When a feedback for
   * the same attempt already exists (unique `attempt_id`, e.g. a concurrent
   * submission), nothing is written and the stored feedback is returned with
   * `created: false` — never an error.
   */
  createWithOutboxEvent(
    feedback: SurveyFeedbackEntity,
    event: SurveyFeedbackSubmittedOutboxEvent,
  ): Promise<CreateSurveyFeedbackResult>;
}
