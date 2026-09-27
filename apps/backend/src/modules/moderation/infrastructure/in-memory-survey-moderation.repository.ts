import { SurveyModerationDecisionEntity } from '../domain/survey-moderation-decision.entity';
import {
  SurveyModerationAuditOutboxEvent,
  SurveyModerationRepositoryPort,
} from '../application/ports/survey-moderation-repository.port';
import { ModerationAlreadyDecidedException } from '../application/exceptions/moderation.exceptions';

/**
 * In-memory adapter for unit tests and e2e overrides. Mirrors the Prisma
 * adapter: one decision per FormVersion and an Outbox audit event per decision.
 */
export class InMemorySurveyModerationRepository implements SurveyModerationRepositoryPort {
  readonly outboxEvents: SurveyModerationAuditOutboxEvent[] = [];
  private readonly decisions = new Map<
    string,
    SurveyModerationDecisionEntity
  >();

  async findByFormVersionId(
    formVersionId: string,
  ): Promise<SurveyModerationDecisionEntity | null> {
    return this.decisions.get(formVersionId) ?? null;
  }

  async saveDecision(
    decision: SurveyModerationDecisionEntity,
    auditEvent: SurveyModerationAuditOutboxEvent,
  ): Promise<SurveyModerationDecisionEntity> {
    const existing = this.decisions.get(decision.formVersionId);
    if (existing) {
      throw new ModerationAlreadyDecidedException(
        decision.formId,
        existing.outcome,
      );
    }
    if (
      this.outboxEvents.some(
        (event) => event.idempotencyKey === auditEvent.idempotencyKey,
      )
    ) {
      throw new Error(
        `Outbox event ${auditEvent.idempotencyKey} already exists.`,
      );
    }
    this.decisions.set(decision.formVersionId, decision);
    this.outboxEvents.push(auditEvent);
    return decision;
  }

  /** Test helper: every stored decision, in insertion order. */
  allDecisions(): SurveyModerationDecisionEntity[] {
    return [...this.decisions.values()];
  }
}
