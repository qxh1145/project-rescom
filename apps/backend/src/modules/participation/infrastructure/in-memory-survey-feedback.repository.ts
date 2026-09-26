import { SurveyFeedbackEntity } from '../domain/survey-feedback.entity';
import {
  CreateSurveyFeedbackResult,
  SurveyFeedbackRepositoryPort,
  SurveyFeedbackSubmittedOutboxEvent,
} from '../application/ports/survey-feedback-repository.port';

/** Story 9.2: in-memory feedback store for unit and e2e tests. */
export class InMemorySurveyFeedbackRepository implements SurveyFeedbackRepositoryPort {
  /** Keyed by attemptId (unique, like the `attempt_id` index). */
  readonly feedback = new Map<string, SurveyFeedbackEntity>();
  readonly outboxEvents: SurveyFeedbackSubmittedOutboxEvent[] = [];

  async findByAttemptId(
    attemptId: string,
  ): Promise<SurveyFeedbackEntity | null> {
    return this.feedback.get(attemptId) ?? null;
  }

  async createWithOutboxEvent(
    feedback: SurveyFeedbackEntity,
    event: SurveyFeedbackSubmittedOutboxEvent,
  ): Promise<CreateSurveyFeedbackResult> {
    const existing = this.feedback.get(feedback.attemptId);
    if (existing) {
      return { created: false, feedback: existing };
    }
    this.feedback.set(feedback.attemptId, feedback);
    this.outboxEvents.push(event);
    return { created: true, feedback };
  }

  all(): SurveyFeedbackEntity[] {
    return [...this.feedback.values()];
  }
}
