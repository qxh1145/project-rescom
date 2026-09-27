import {
  SURVEY_FEEDBACK_COMMENT_MAX_LENGTH,
  SURVEY_FEEDBACK_RATING_MAX,
  SURVEY_FEEDBACK_RATING_MIN,
  isSameSurveyFeedbackContent,
  type SurveyFeedbackContent,
  type SurveyFeedbackDto,
  type SurveyFeedbackIssueTag,
  type SurveyFeedbackValidationStatus,
} from '@rescom/schemas';

export interface SurveyFeedbackProps {
  id: string;
  attemptId: string;
  /** Internal Forms only: the attempt's validated Response. */
  responseId: string | null;
  formId: string;
  formVersionId: string;
  respondentId: string;
  formType: 'INTERNAL' | 'EXTERNAL';
  rating: number;
  comment: string | null;
  issueTags: SurveyFeedbackIssueTag[];
  validationStatus: SurveyFeedbackValidationStatus;
  validatedAt: Date | null;
  submittedAt: Date;
}

/**
 * Story 9.2 (FR-43): a Respondent's post-completion feedback on one completed
 * Attempt. Immutable evidence owned by Participation; it enters Survey Quality
 * aggregation only after the (Phase-2) validator marks it ACCEPTED.
 */
export class SurveyFeedbackEntity {
  readonly id: string;
  readonly attemptId: string;
  readonly responseId: string | null;
  readonly formId: string;
  readonly formVersionId: string;
  readonly respondentId: string;
  readonly formType: 'INTERNAL' | 'EXTERNAL';
  readonly rating: number;
  readonly comment: string | null;
  readonly issueTags: SurveyFeedbackIssueTag[];
  readonly validationStatus: SurveyFeedbackValidationStatus;
  readonly validatedAt: Date | null;
  readonly submittedAt: Date;

  constructor(props: SurveyFeedbackProps) {
    if (
      !Number.isInteger(props.rating) ||
      props.rating < SURVEY_FEEDBACK_RATING_MIN ||
      props.rating > SURVEY_FEEDBACK_RATING_MAX
    ) {
      throw new Error('rating must be an integer between 1 and 5');
    }
    if (
      props.comment !== null &&
      (props.comment.length === 0 ||
        props.comment.length > SURVEY_FEEDBACK_COMMENT_MAX_LENGTH)
    ) {
      throw new Error('comment must be null or 1..500 characters');
    }
    if (props.formType === 'EXTERNAL' && props.responseId !== null) {
      throw new Error('External feedback has no Response');
    }
    if (props.formType === 'INTERNAL' && props.responseId === null) {
      throw new Error('Internal feedback requires its validated Response');
    }
    this.id = props.id;
    this.attemptId = props.attemptId;
    this.responseId = props.responseId;
    this.formId = props.formId;
    this.formVersionId = props.formVersionId;
    this.respondentId = props.respondentId;
    this.formType = props.formType;
    this.rating = props.rating;
    this.comment = props.comment;
    this.issueTags = [...props.issueTags];
    this.validationStatus = props.validationStatus;
    this.validatedAt = props.validatedAt;
    this.submittedAt = props.submittedAt;
  }

  /** Replay rule shared with the frontend mock (rating, comment, tag set). */
  hasSameContent(content: SurveyFeedbackContent): boolean {
    return isSameSurveyFeedbackContent(this, content);
  }

  /** The owner's view: no respondent or response identity. */
  toDto(): SurveyFeedbackDto {
    return {
      id: this.id,
      attemptId: this.attemptId,
      formId: this.formId,
      formVersionId: this.formVersionId,
      formType: this.formType,
      rating: this.rating,
      comment: this.comment,
      issueTags: [...this.issueTags],
      validationStatus: this.validationStatus,
      submittedAt: this.submittedAt.toISOString(),
    };
  }
}
