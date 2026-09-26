import {
  SurveyModerationDecisionDto,
  SurveyModerationOutcome,
} from '@rescom/schemas';

export interface SurveyModerationDecisionProps {
  id: string;
  formId: string;
  formVersionId: string;
  versionNumber: number;
  outcome: SurveyModerationOutcome;
  adminId: string;
  reason: string | null;
  refundAmount: number;
  refundJournalId: string | null;
  correlationId: string;
  decidedAt: Date;
}

interface DecisionBase {
  id: string;
  formId: string;
  formVersionId: string;
  versionNumber: number;
  adminId: string;
  correlationId: string;
  decidedAt: Date;
}

/**
 * One Admin moderation decision on one submitted FormVersion (Story 8.1,
 * FR-20/FR-53). Immutable, append-only evidence owned by Moderation.
 */
export class SurveyModerationDecisionEntity {
  readonly id: string;
  readonly formId: string;
  readonly formVersionId: string;
  readonly versionNumber: number;
  readonly outcome: SurveyModerationOutcome;
  readonly adminId: string;
  readonly reason: string | null;
  readonly refundAmount: number;
  readonly refundJournalId: string | null;
  readonly correlationId: string;
  readonly decidedAt: Date;

  constructor(props: SurveyModerationDecisionProps) {
    if (!Number.isInteger(props.refundAmount) || props.refundAmount < 0) {
      throw new Error('refundAmount must be a non-negative integer');
    }
    if (props.outcome === 'APPROVED' && props.refundAmount !== 0) {
      throw new Error('An approval never refunds Escrow');
    }
    if (props.outcome === 'REJECTED' && !props.reason) {
      throw new Error('A rejection requires a reason');
    }
    this.id = props.id;
    this.formId = props.formId;
    this.formVersionId = props.formVersionId;
    this.versionNumber = props.versionNumber;
    this.outcome = props.outcome;
    this.adminId = props.adminId;
    this.reason = props.reason;
    this.refundAmount = props.refundAmount;
    this.refundJournalId = props.refundJournalId;
    this.correlationId = props.correlationId;
    this.decidedAt = props.decidedAt;
  }

  static approve(
    props: DecisionBase & { note?: string | null },
  ): SurveyModerationDecisionEntity {
    return new SurveyModerationDecisionEntity({
      ...props,
      outcome: 'APPROVED',
      reason: props.note ? props.note : null,
      refundAmount: 0,
      refundJournalId: null,
    });
  }

  static reject(
    props: DecisionBase & {
      reason: string;
      refundAmount: number;
      refundJournalId: string | null;
    },
  ): SurveyModerationDecisionEntity {
    return new SurveyModerationDecisionEntity({
      ...props,
      outcome: 'REJECTED',
    });
  }

  isApproved(): boolean {
    return this.outcome === 'APPROVED';
  }

  toDto(): SurveyModerationDecisionDto {
    return {
      id: this.id,
      formId: this.formId,
      formVersionId: this.formVersionId,
      versionNumber: this.versionNumber,
      outcome: this.outcome,
      adminId: this.adminId,
      reason: this.reason,
      refundAmount: this.refundAmount,
      refundJournalId: this.refundJournalId,
      correlationId: this.correlationId,
      decidedAt: this.decidedAt.toISOString(),
    };
  }
}
