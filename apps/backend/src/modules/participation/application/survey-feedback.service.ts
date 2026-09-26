import { randomUUID } from 'crypto';
import {
  SURVEY_FEEDBACK_SUBMITTED_EVENT_TYPE,
  surveyFeedbackSubmittedEventPayloadSchema,
  type SubmitSurveyFeedbackCommand,
  type SubmitSurveyFeedbackResultDto,
  type SurveyFeedbackStatusDto,
} from '@rescom/schemas';
import { FormRepositoryPort } from '../../forms/application/ports/form-repository.port';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';
import { SurveyFeedbackEntity } from '../domain/survey-feedback.entity';
import { ParticipationRepositoryPort } from './ports/participation-repository.port';
import { ExternalCreditStatePort } from './ports/external-credit-state.port';
import {
  SurveyFeedbackRepositoryPort,
  SurveyFeedbackSubmittedOutboxEvent,
} from './ports/survey-feedback-repository.port';
import {
  SurveyFeedbackAlreadySubmittedException,
  SurveyFeedbackAttemptNotFoundException,
  SurveyFeedbackNotAllowedException,
} from './exceptions/survey-feedback.exceptions';

export interface SurveyFeedbackServiceDeps {
  feedbackRepository: SurveyFeedbackRepositoryPort;
  participationRepository: ParticipationRepositoryPort;
  formRepository: FormRepositoryPort;
  /**
   * Epic 9 review P3: state of the External completion credit, so feedback on
   * a reversed (upheld-dispute) completion is refused. Absent = not checked.
   */
  externalCredits?: ExternalCreditStatePort;
  now?: () => Date;
  generateId?: () => string;
}

type Eligibility =
  | {
      eligible: true;
      formType: 'INTERNAL' | 'EXTERNAL';
      responseId: string | null;
    }
  | { eligible: false; reason: string };

/**
 * Story 9.2 (FR-43): post-completion feedback use cases, owned by the
 * Participation context. Only the owner of a completed attempt may rate it
 * (Internal: its Response must be VALIDATED; External: its completion credit
 * must not be reversed), at most once, and never the survey's own publisher
 * (Epic 9 review P2/P3). Feedback has no
 * Economy/Notification side effects, so giving or skipping it can never
 * change rewards. Rows start `PENDING`: the Phase-2 Survey Quality validator
 * consumes the `SurveyFeedbackSubmitted` Outbox event and only ACCEPTED
 * feedback is ever aggregated.
 */
export class SurveyFeedbackService {
  private readonly feedbackRepository: SurveyFeedbackRepositoryPort;
  private readonly participationRepository: ParticipationRepositoryPort;
  private readonly formRepository: FormRepositoryPort;
  private readonly externalCredits?: ExternalCreditStatePort;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(deps: SurveyFeedbackServiceDeps) {
    this.feedbackRepository = deps.feedbackRepository;
    this.participationRepository = deps.participationRepository;
    this.formRepository = deps.formRepository;
    this.externalCredits = deps.externalCredits;
    this.now = deps.now ?? (() => new Date());
    this.generateId = deps.generateId ?? (() => randomUUID());
  }

  async getFeedbackStatus(
    attemptId: string,
    callerUserId: string,
  ): Promise<SurveyFeedbackStatusDto> {
    const attempt = await this.loadOwnedAttempt(attemptId, callerUserId);

    const existing = await this.feedbackRepository.findByAttemptId(attempt.id);
    if (existing) {
      return {
        attemptId: attempt.id,
        state: 'SUBMITTED',
        feedback: existing.toDto(),
      };
    }

    const eligibility = await this.resolveEligibility(attempt);
    return {
      attemptId: attempt.id,
      state: eligibility.eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE',
      feedback: null,
    };
  }

  /**
   * One feedback per attempt: an identical re-submission (e.g. a network
   * retry) returns the stored feedback with `replayed: true`; a different one
   * is a conflict. Feedback + Outbox event commit atomically (AD-10).
   */
  async submitFeedback(
    attemptId: string,
    callerUserId: string,
    command: SubmitSurveyFeedbackCommand,
  ): Promise<SubmitSurveyFeedbackResultDto> {
    const attempt = await this.loadOwnedAttempt(attemptId, callerUserId);

    const existing = await this.feedbackRepository.findByAttemptId(attempt.id);
    if (existing) {
      return this.replayOrConflict(existing, command);
    }

    const eligibility = await this.resolveEligibility(attempt);
    if (!eligibility.eligible) {
      throw new SurveyFeedbackNotAllowedException(eligibility.reason);
    }

    const feedback = new SurveyFeedbackEntity({
      id: this.generateId(),
      attemptId: attempt.id,
      responseId: eligibility.responseId,
      formId: attempt.surveyId,
      formVersionId: attempt.formVersionId,
      respondentId: callerUserId,
      formType: eligibility.formType,
      rating: command.rating,
      comment: command.comment,
      issueTags: command.issueTags,
      validationStatus: 'PENDING',
      validatedAt: null,
      submittedAt: this.now(),
    });

    const result = await this.feedbackRepository.createWithOutboxEvent(
      feedback,
      this.buildSubmittedEvent(feedback),
    );
    if (!result.created) {
      // A concurrent submission for this attempt committed first.
      return this.replayOrConflict(result.feedback, command);
    }
    return { feedback: result.feedback.toDto(), replayed: false };
  }

  private replayOrConflict(
    existing: SurveyFeedbackEntity,
    command: SubmitSurveyFeedbackCommand,
  ): SubmitSurveyFeedbackResultDto {
    if (!existing.hasSameContent(command)) {
      throw new SurveyFeedbackAlreadySubmittedException();
    }
    return { feedback: existing.toDto(), replayed: true };
  }

  /** Unknown, guest and other users' attempts are indistinguishable (404). */
  private async loadOwnedAttempt(
    attemptId: string,
    callerUserId: string,
  ): Promise<SurveyAttemptEntity> {
    const attempt =
      await this.participationRepository.findAttemptById(attemptId);
    if (!attempt || attempt.isGuest || attempt.respondentId !== callerUserId) {
      throw new SurveyFeedbackAttemptNotFoundException();
    }
    return attempt;
  }

  private async resolveEligibility(
    attempt: SurveyAttemptEntity,
  ): Promise<Eligibility> {
    if (attempt.status !== 'COMPLETED') {
      return {
        eligible: false,
        reason:
          'Feedback is available only after the survey attempt has been completed.',
      };
    }

    const formWithVersion = await this.formRepository.findById(
      attempt.surveyId,
    );
    if (!formWithVersion) {
      throw new SurveyFeedbackAttemptNotFoundException();
    }

    // Epic 9 review P2: a publisher's rating of their own survey is not
    // independent quality evidence (whatever Epic 4 DN2 decides about
    // self-participation).
    if (formWithVersion.form.isOwnedBy(attempt.respondentId ?? '')) {
      return {
        eligible: false,
        reason: 'Publishers cannot rate their own survey.',
      };
    }

    if (formWithVersion.form.type === 'EXTERNAL') {
      // Epic 9 review P3: a reversed completion credit (Phase 1 upheld
      // dispute) cannot be rated. Open dispute holds deliberately do not
      // block feedback (a publisher could suppress it by opening one).
      const creditState = await this.externalCredits?.getExternalCreditState(
        attempt.id,
      );
      if (creditState === 'REVERSED') {
        return {
          eligible: false,
          reason:
            'This survey completion was reversed and can no longer be rated.',
        };
      }
      return { eligible: true, formType: 'EXTERNAL', responseId: null };
    }

    const response = await this.participationRepository.findResponseByAttemptId(
      attempt.id,
    );
    if (
      !response ||
      response.status !== 'VALIDATED' ||
      response.isGuest ||
      response.respondentId !== attempt.respondentId
    ) {
      return {
        eligible: false,
        reason:
          'Feedback is available only for a successfully validated survey response.',
      };
    }
    return { eligible: true, formType: 'INTERNAL', responseId: response.id };
  }

  private buildSubmittedEvent(
    feedback: SurveyFeedbackEntity,
  ): SurveyFeedbackSubmittedOutboxEvent {
    // Producer-side contract check (versioned event schema, AD-10).
    const payload = surveyFeedbackSubmittedEventPayloadSchema.parse({
      schemaVersion: 1,
      feedbackId: feedback.id,
      attemptId: feedback.attemptId,
      responseId: feedback.responseId,
      formId: feedback.formId,
      formVersionId: feedback.formVersionId,
      formType: feedback.formType,
      respondentId: feedback.respondentId,
      rating: feedback.rating,
      issueTags: [...feedback.issueTags],
      hasComment: feedback.comment !== null,
      validationStatus: 'PENDING',
      submittedAt: feedback.submittedAt.toISOString(),
    });

    return {
      id: this.generateId(),
      idempotencyKey: `survey-feedback:${feedback.attemptId}`,
      eventType: SURVEY_FEEDBACK_SUBMITTED_EVENT_TYPE,
      schemaVersion: 1,
      producer: 'participation-service',
      aggregateType: 'SurveyFeedback',
      aggregateId: feedback.id,
      payload,
    };
  }
}
