import { randomUUID } from 'crypto';
import {
  ModerationQueueItemDto,
  ModerationQueueListDto,
  ModerationSurveyPreviewDto,
  NOTIFICATION_MESSAGE_MAX_LENGTH,
  SURVEY_MODERATION_AUDIT_EVENT_TYPES,
  SurveyModerationAuditEventPayload,
  SurveyModerationOutcome,
  SurveyModerationResultDto,
  approveSurveyModerationSchema,
  calculateEscrowCost,
  listModerationQueueQuerySchema,
  parseStoredTargeting,
  rejectSurveyModerationSchema,
  surveyModerationAuditEventPayloadSchema,
  surveyModerationKey,
  truncateText,
} from '@rescom/schemas';
import { z } from 'zod';
import {
  PassThroughUnitOfWork,
  UnitOfWorkPort,
} from '../../../common/database/unit-of-work.port';
import { AdminCapabilityPort } from '../../economy/application/ports/admin-capability.port';
import { FormModerationCommands } from '../../forms/application/form-moderation.commands';
import { FormWithVersion } from '../../forms/application/ports/form-repository.port';
import { FormNotFoundException } from '../../forms/application/exceptions/form.exceptions';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import { SurveyModerationDecisionEntity } from '../domain/survey-moderation-decision.entity';
import { PublisherDirectoryPort } from './ports/publisher-directory.port';
import {
  SurveyModerationAuditOutboxEvent,
  SurveyModerationRepositoryPort,
} from './ports/survey-moderation-repository.port';
import {
  FormNotInModerationQueueException,
  InvalidModerationRequestException,
  ModerationAdminCapabilityRequiredException,
  ModerationAlreadyDecidedException,
  ModerationSelfReviewForbiddenException,
  ModerationVersionMismatchException,
} from './exceptions/moderation.exceptions';

export interface SurveyModerationServiceDependencies {
  forms: FormModerationCommands;
  repository: SurveyModerationRepositoryPort;
  adminCapability: AdminCapabilityPort;
  publisherDirectory: PublisherDirectoryPort;
  unitOfWork?: UnitOfWorkPort;
  notificationPublisher?: NotificationPublisherPort;
  generateId?: () => string;
  now?: () => Date;
}

export interface ModerationCommand {
  formId: string;
  adminId: string;
  /** Raw body: validated here as well as by the controller pipe. */
  input: unknown;
  correlationId?: string | null;
}

interface DecisionOutcome {
  decision: SurveyModerationDecisionEntity;
  record: FormWithVersion | null;
  title: string;
  publisherId: string;
  replayed: boolean;
  /**
   * The decided version replaced a survey that was already live (decision
   * E8-D2): rejecting it closed the whole survey for good, including the
   * previously approved version, so the notification says so.
   */
  isResubmission: boolean;
}

const AUDIT_PRODUCER = 'moderation-service';
const AUDIT_AGGREGATE_TYPE = 'Form';
const NOTIFICATION_TITLE_MAX_LENGTH = 80;
const NOTIFICATION_REASON_MAX_LENGTH = 250;
/**
 * Decision E8-D2: appended to the SURVEY_REJECTED notice when the rejected
 * version replaced a survey that was already live.
 */
export const RESUBMISSION_REJECTION_WARNING =
  'Because this edit replaced a live survey, the whole survey is now closed for good, including the previously approved version, and it cannot be reopened.';
/** Metadata default (`formIntegrityMetadataSchema`) for a missing/invalid value. */
const DEFAULT_EFFORT_SECONDS = 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Survey moderation coordinator (Story 8.1, FR-20/FR-53, AD-16).
 *
 * Approve/reject run under one Unit of Work keyed `moderation:{formVersionId}`:
 * the actor's live Admin capability is re-verified, Research performs the
 * conditional `MODERATION_QUEUE → PUBLISHED | CLOSED` transition (rejection
 * also posts the Economy refund `close-refund:{formId}:c{closeCount}`), and
 * Moderation records the decision plus its replayable admin-audit Outbox
 * event. Notifications go out only after the Unit of Work committed.
 */
export class SurveyModerationService {
  private readonly forms: FormModerationCommands;
  private readonly repository: SurveyModerationRepositoryPort;
  private readonly adminCapability: AdminCapabilityPort;
  private readonly publisherDirectory: PublisherDirectoryPort;
  private readonly unitOfWork: UnitOfWorkPort;
  private readonly notificationPublisher?: NotificationPublisherPort;
  private readonly generateId: () => string;
  private readonly now: () => Date;

  constructor(deps: SurveyModerationServiceDependencies) {
    this.forms = deps.forms;
    this.repository = deps.repository;
    this.adminCapability = deps.adminCapability;
    this.publisherDirectory = deps.publisherDirectory;
    this.unitOfWork = deps.unitOfWork ?? new PassThroughUnitOfWork();
    this.notificationPublisher = deps.notificationPublisher;
    this.generateId = deps.generateId ?? randomUUID;
    this.now = deps.now ?? (() => new Date());
  }

  /** FR-20: surveys awaiting moderation, oldest submission first. */
  async listQueue(query: unknown): Promise<ModerationQueueListDto> {
    const { limit, offset } = this.parse(
      listModerationQueueQuerySchema,
      query ?? {},
    );
    const page = await this.forms.listQueue({ limit, offset });
    const emails = await this.publisherDirectory.findEmails([
      ...new Set(page.items.map((item) => item.form.publisherId)),
    ]);
    return {
      items: page.items.map((record) =>
        this.toQueueItem(record, emails.get(record.form.publisherId) ?? null),
      ),
      total: page.total,
      limit,
      offset,
      hasMore: offset + page.items.length < page.total,
    };
  }

  /**
   * FR-53 preview: queue fields, Form Definition, the decision (if any) and,
   * while the survey is queued, the Escrow it actually holds and the funding
   * shortfall that blocks approval (Epic 8 review P2). The list keeps the
   * cost quote only (no ledger scan per item).
   */
  async getSurvey(formId: string): Promise<ModerationSurveyPreviewDto> {
    const record = await this.forms.findForReview(formId);
    if (!record) {
      throw new FormNotFoundException(formId);
    }
    const emails = await this.publisherDirectory.findEmails([
      record.form.publisherId,
    ]);
    const decision = await this.repository.findByFormVersionId(
      record.currentVersion.id,
    );
    const funding =
      record.form.status === 'MODERATION_QUEUE'
        ? await this.forms.getFundingPosition(record)
        : null;
    return {
      ...this.toQueueItem(record, emails.get(record.form.publisherId) ?? null),
      schemaJson: record.currentVersion.schemaJson,
      decision: decision ? decision.toDto() : null,
      escrowHeld: funding ? funding.held : null,
      fundingShortfall: funding ? funding.shortfall : null,
    };
  }

  /** `MODERATION_QUEUE → PUBLISHED` (FR-53). */
  async approve(
    command: ModerationCommand,
  ): Promise<SurveyModerationResultDto> {
    const { formVersionId, note } = this.parse(
      approveSurveyModerationSchema,
      command.input,
    );
    const correlationId = this.resolveCorrelationId(command.correlationId);

    const outcome = await this.unitOfWork.run<DecisionOutcome>(
      surveyModerationKey(formVersionId),
      async () => {
        await this.assertAdminCapability(command.adminId);
        const existing =
          await this.repository.findByFormVersionId(formVersionId);
        if (existing) {
          return this.replayOrConflict(existing, 'APPROVED', command.formId);
        }

        const snapshot = await this.loadQueued(
          command.formId,
          formVersionId,
          command.adminId,
        );
        const decidedAt = this.now();
        const approved = await this.forms.approvePublication(
          snapshot,
          decidedAt,
        );
        if (!approved) {
          return this.resolveLostTransition(
            command.formId,
            formVersionId,
            'APPROVED',
          );
        }

        const decision = SurveyModerationDecisionEntity.approve({
          id: this.generateId(),
          formId: snapshot.form.id,
          formVersionId,
          versionNumber: snapshot.currentVersion.versionNumber,
          adminId: command.adminId,
          note: note ?? null,
          correlationId,
          decidedAt,
        });
        const saved = await this.repository.saveDecision(
          decision,
          this.buildAuditEvent(decision, snapshot.form.publisherId, null),
        );
        return {
          decision: saved,
          record: approved,
          title: snapshot.form.title,
          publisherId: snapshot.form.publisherId,
          replayed: false,
          isResubmission: this.forms.hasEarlierLiveVersion(snapshot),
        };
      },
    );

    await this.notify(outcome);
    return this.toResult(outcome);
  }

  /** `MODERATION_QUEUE → CLOSED` with the Escrow refund (FR-20, FR-53). */
  async reject(command: ModerationCommand): Promise<SurveyModerationResultDto> {
    const { formVersionId, reason } = this.parse(
      rejectSurveyModerationSchema,
      command.input,
    );
    const correlationId = this.resolveCorrelationId(command.correlationId);

    const outcome = await this.unitOfWork.run<DecisionOutcome>(
      surveyModerationKey(formVersionId),
      async () => {
        await this.assertAdminCapability(command.adminId);
        const existing =
          await this.repository.findByFormVersionId(formVersionId);
        if (existing) {
          return this.replayOrConflict(existing, 'REJECTED', command.formId);
        }

        const snapshot = await this.loadQueued(
          command.formId,
          formVersionId,
          command.adminId,
        );
        const decidedAt = this.now();
        const rejected = await this.forms.rejectPublication(
          snapshot,
          decidedAt,
        );
        if (!rejected) {
          return this.resolveLostTransition(
            command.formId,
            formVersionId,
            'REJECTED',
          );
        }

        const decision = SurveyModerationDecisionEntity.reject({
          id: this.generateId(),
          formId: snapshot.form.id,
          formVersionId,
          versionNumber: snapshot.currentVersion.versionNumber,
          adminId: command.adminId,
          reason,
          refundAmount: rejected.refund.refundAmount,
          refundJournalId: rejected.refund.refundJournalId,
          correlationId,
          decidedAt,
        });
        // The key of the refund journal actually posted (Epic 6 review P3:
        // `close-refund:{formId}:c{closeCount}`), never recomputed here.
        const ledgerKey = rejected.refund.refundIdempotencyKey;
        const saved = await this.repository.saveDecision(
          decision,
          this.buildAuditEvent(decision, snapshot.form.publisherId, ledgerKey),
        );
        return {
          decision: saved,
          record: rejected.record,
          title: snapshot.form.title,
          publisherId: snapshot.form.publisherId,
          replayed: false,
          isResubmission: this.forms.hasEarlierLiveVersion(snapshot),
        };
      },
    );

    await this.notify(outcome);
    return this.toResult(outcome);
  }

  /**
   * Live Identity capability inside the Unit of Work (the PostgreSQL port holds
   * a `FOR SHARE` lock), not the session role.
   */
  private async assertAdminCapability(adminId: string): Promise<void> {
    const capability =
      await this.adminCapability.findCurrentCapability(adminId);
    if (
      !capability ||
      capability.role !== 'ADMIN' ||
      capability.status !== 'ACTIVE'
    ) {
      throw new ModerationAdminCapabilityRequiredException();
    }
  }

  private async loadQueued(
    formId: string,
    formVersionId: string,
    adminId: string,
  ): Promise<FormWithVersion> {
    const record = await this.forms.findForReview(formId);
    if (!record) {
      throw new FormNotFoundException(formId);
    }
    if (record.form.publisherId === adminId) {
      throw new ModerationSelfReviewForbiddenException();
    }
    if (record.form.status !== 'MODERATION_QUEUE') {
      throw new FormNotInModerationQueueException(formId, record.form.status);
    }
    if (record.currentVersion.id !== formVersionId) {
      throw new ModerationVersionMismatchException(formId);
    }
    return record;
  }

  /** Same decision → idempotent replay without side effects; else conflict. */
  private async replayOrConflict(
    existing: SurveyModerationDecisionEntity,
    intended: SurveyModerationOutcome,
    formId: string,
  ): Promise<DecisionOutcome> {
    if (existing.formId !== formId) {
      throw new ModerationVersionMismatchException(formId);
    }
    if (existing.outcome !== intended) {
      throw new ModerationAlreadyDecidedException(formId, existing.outcome);
    }
    const record = await this.forms.findForReview(formId);
    return {
      decision: existing,
      record,
      title: record?.form.title ?? '',
      publisherId: record?.form.publisherId ?? '',
      replayed: true,
      isResubmission: record
        ? hasApprovedVersionBefore(record, existing.versionNumber)
        : false,
    };
  }

  /**
   * The conditional transition lost (a concurrent decision, withdrawal or
   * version change won). Replay the winner when it is the same decision.
   */
  private async resolveLostTransition(
    formId: string,
    formVersionId: string,
    intended: SurveyModerationOutcome,
  ): Promise<DecisionOutcome> {
    const winner = await this.repository.findByFormVersionId(formVersionId);
    if (winner) {
      return this.replayOrConflict(winner, intended, formId);
    }
    const latest = await this.forms.findForReview(formId);
    if (!latest) {
      throw new FormNotFoundException(formId);
    }
    if (
      latest.form.status === 'MODERATION_QUEUE' &&
      latest.currentVersion.id !== formVersionId
    ) {
      throw new ModerationVersionMismatchException(formId);
    }
    throw new FormNotInModerationQueueException(formId, latest.form.status);
  }

  private buildAuditEvent(
    decision: SurveyModerationDecisionEntity,
    publisherId: string,
    ledgerIdempotencyKey: string | null,
  ): SurveyModerationAuditOutboxEvent {
    const payload: SurveyModerationAuditEventPayload =
      surveyModerationAuditEventPayloadSchema.parse({
        schemaVersion: 1,
        auditCategory: 'MODERATION_ADMIN_ACTION',
        action: decision.isApproved() ? 'SURVEY_APPROVED' : 'SURVEY_REJECTED',
        decisionId: decision.id,
        formId: decision.formId,
        formVersionId: decision.formVersionId,
        versionNumber: decision.versionNumber,
        publisherId,
        adminId: decision.adminId,
        reason: decision.reason,
        refundAmount: decision.refundAmount,
        refundJournalId: decision.refundJournalId,
        ledgerIdempotencyKey,
        correlationId: decision.correlationId,
        occurredAt: decision.decidedAt.toISOString(),
      });

    return {
      id: this.generateId(),
      idempotencyKey: `admin-audit:${surveyModerationKey(decision.formVersionId)}`,
      eventType: decision.isApproved()
        ? SURVEY_MODERATION_AUDIT_EVENT_TYPES.APPROVED
        : SURVEY_MODERATION_AUDIT_EVENT_TYPES.REJECTED,
      producer: AUDIT_PRODUCER,
      aggregateType: AUDIT_AGGREGATE_TYPE,
      aggregateId: decision.formId,
      aggregateVersion: decision.versionNumber,
      correlationId: decision.correlationId,
      payload,
    };
  }

  /**
   * SURVEY_APPROVED / SURVEY_REJECTED to the Publisher (FR-20), after commit.
   * Replays re-publish; the port deduplicates by `moderation:{formVersionId}`.
   */
  private async notify(outcome: DecisionOutcome): Promise<void> {
    if (!this.notificationPublisher || !outcome.publisherId) {
      return;
    }
    const { decision } = outcome;
    const title = truncate(outcome.title, NOTIFICATION_TITLE_MAX_LENGTH);
    let message: string;
    if (decision.isApproved()) {
      message = `Your survey "${title}" was approved by moderation and is now live on the Marketplace.`;
    } else {
      const refund =
        decision.refundAmount > 0
          ? ` ${decision.refundAmount} escrowed points were returned to your Available balance.`
          : '';
      // Decision E8-D2 (option A): rejecting an edited version of a live
      // survey closes the whole survey for good (AC1.6/AC5.4). Say so
      // explicitly; the warning and the refund always fit, the reason gets
      // what is left of the message budget.
      const head = outcome.isResubmission
        ? `Your edited survey "${title}" (version ${decision.versionNumber}) was rejected by moderation. ${RESUBMISSION_REJECTION_WARNING}`
        : `Your survey "${title}" was rejected by moderation.`;
      const reasonBudget = Math.min(
        NOTIFICATION_REASON_MAX_LENGTH,
        NOTIFICATION_MESSAGE_MAX_LENGTH -
          head.length -
          refund.length -
          ' Reason: .'.length,
      );
      const reason = truncate(decision.reason ?? '', reasonBudget);
      message = `${head} Reason: ${reason}.${refund}`;
    }
    await this.notificationPublisher.publish({
      userId: outcome.publisherId,
      type: decision.isApproved() ? 'SURVEY_APPROVED' : 'SURVEY_REJECTED',
      message: truncate(message, NOTIFICATION_MESSAGE_MAX_LENGTH),
      dedupeKey: surveyModerationKey(decision.formVersionId),
    });
  }

  private toResult(outcome: DecisionOutcome): SurveyModerationResultDto {
    const { decision, record } = outcome;
    const current = record?.currentVersion;
    return {
      decision: decision.toDto(),
      form: {
        id: decision.formId,
        status:
          record?.form.status ??
          (decision.isApproved() ? 'PUBLISHED' : 'CLOSED'),
        currentVersionId: current?.id ?? decision.formVersionId,
        isPublished: current?.isPublished ?? decision.isApproved(),
        publishedAt: current?.publishedAt
          ? current.publishedAt.toISOString()
          : null,
      },
      replayed: outcome.replayed,
    };
  }

  private toQueueItem(
    record: FormWithVersion,
    publisherEmail: string | null,
  ): ModerationQueueItemDto {
    const { form, currentVersion } = record;
    const cost = calculateEscrowCost({
      type: form.type,
      expectedCompletions: form.expectedCompletions,
      rewardPerResponse: form.rewardPerResponse,
    });
    const schema = currentVersion.schemaJson;
    // One malformed stored row must not break the whole queue (Epic 8 review
    // P6): invalid targeting is flagged (approval refuses it), an invalid
    // effort falls back to the metadata default.
    const targeting = parseStoredTargeting(currentVersion.targetingJson);
    const effort: unknown = schema?.metadata?.expectedEffortSeconds;
    return {
      formId: form.id,
      formVersionId: currentVersion.id,
      versionNumber: currentVersion.versionNumber,
      title: form.title,
      description: form.description,
      type: form.type,
      status: form.status,
      publisherId: form.publisherId,
      publisherEmail,
      rewardPerResponse: form.rewardPerResponse,
      expectedCompletions: form.expectedCompletions,
      effectiveRewardPerResponse: cost.effectiveRewardPerResponse,
      escrowAmount: cost.effectiveCost,
      estimatedEffortSeconds:
        typeof effort === 'number' && Number.isInteger(effort) && effort >= 0
          ? effort
          : DEFAULT_EFFORT_SECONDS,
      blocksCount: Array.isArray(schema?.blocks) ? schema.blocks.length : 0,
      externalUrl: currentVersion.externalUrl,
      targetingJson: targeting.ok ? targeting.targeting : null,
      targetingInvalid: !targeting.ok,
      isResubmission: this.forms.hasEarlierLiveVersion(record),
      submittedAt: form.updatedAt.toISOString(),
    };
  }

  private resolveCorrelationId(candidate?: string | null): string {
    return candidate && UUID_PATTERN.test(candidate)
      ? candidate.toLowerCase()
      : this.generateId();
  }

  private parse<S extends z.ZodTypeAny>(
    schema: S,
    value: unknown,
  ): z.output<S> {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new InvalidModerationRequestException(
        result.error.errors[0]?.message ?? 'The moderation request is invalid.',
      );
    }
    return result.data;
  }
}

/** Epic 9 review P9: never splits an emoji into a lone surrogate. */
/** True when a version older than `versionNumber` was approved (went live). */
function hasApprovedVersionBefore(
  record: FormWithVersion,
  versionNumber: number,
): boolean {
  return (record.versions ?? [record.currentVersion]).some(
    (version) => version.isPublished && version.versionNumber < versionNumber,
  );
}

function truncate(text: string, max: number): string {
  return truncateText(text, max);
}
