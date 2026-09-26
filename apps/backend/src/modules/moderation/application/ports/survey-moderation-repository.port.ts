import { SurveyModerationAuditEventPayload } from '@rescom/schemas';
import { SurveyModerationDecisionEntity } from '../../domain/survey-moderation-decision.entity';

export const SURVEY_MODERATION_REPOSITORY_PORT = Symbol(
  'SURVEY_MODERATION_REPOSITORY_PORT',
);

/**
 * Replayable Moderation admin-audit event appended to the Outbox in the same
 * transaction as the decision (AD-16, mirrors Story 6.6 `AdminTopUpApproved`).
 */
export interface SurveyModerationAuditOutboxEvent {
  id: string;
  idempotencyKey: string;
  eventType: string;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  payload: SurveyModerationAuditEventPayload;
}

/** Moderation-owned persistence of survey moderation decisions (Story 8.1). */
export interface SurveyModerationRepositoryPort {
  findByFormVersionId(
    formVersionId: string,
  ): Promise<SurveyModerationDecisionEntity | null>;

  /**
   * Inserts the decision and its admin-audit Outbox event atomically, joining
   * the caller's Unit of Work. A second decision for the same FormVersion
   * raises `ModerationAlreadyDecidedException` (unique `formVersionId`).
   */
  saveDecision(
    decision: SurveyModerationDecisionEntity,
    auditEvent: SurveyModerationAuditOutboxEvent,
  ): Promise<SurveyModerationDecisionEntity>;
}
