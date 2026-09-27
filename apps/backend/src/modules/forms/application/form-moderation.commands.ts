import {
  CloseEscrowResult,
  EscrowFundingPosition,
  FormsEscrowCoordinator,
} from './forms-escrow.coordinator';
import { ModerationEscrowNotFundedException } from './exceptions/form.exceptions';
import { assertFormPublishable } from './form-publishability';
import {
  FormRepositoryPort,
  FormWithVersion,
  ModerationQueuePage,
  ModerationQueueParams,
} from './ports/form-repository.port';

export interface PublicationRejectionResult {
  record: FormWithVersion;
  refund: CloseEscrowResult;
}

const NO_REFUND: CloseEscrowResult = {
  refundJournalId: null,
  refundIdempotencyKey: null,
  refundAmount: 0,
  unusedCompletions: 0,
};

/**
 * Research-owned commands the Moderation coordinator invokes (Story 8.1,
 * AD-16). Research alone writes Form/FormVersion; Economy alone writes the
 * refund journal (through `FormsEscrowCoordinator`). Both run inside the
 * caller's Unit of Work, so the decision, the transition and the refund
 * commit or roll back together.
 *
 * Transitions are conditional on the snapshot the caller validated
 * (`MODERATION_QUEUE` + unchanged `updatedAt`): a concurrent decision, a
 * Publisher withdrawal or a completion-code rotation makes them return `null`
 * instead of overwriting the winner.
 */
export class FormModerationCommands {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly escrowCoordinator?: FormsEscrowCoordinator,
  ) {}

  listQueue(params: ModerationQueueParams): Promise<ModerationQueuePage> {
    return this.formRepository.findModerationQueue(params);
  }

  findForReview(formId: string): Promise<FormWithVersion | null> {
    return this.formRepository.findById(formId);
  }

  /** True when an earlier version of this survey was already live. */
  hasEarlierLiveVersion(record: FormWithVersion): boolean {
    return (record.versions ?? []).some(
      (version) =>
        version.isPublished && version.id !== record.currentVersion.id,
    );
  }

  /**
   * How well the survey's open quota is funded by the Escrow it holds (Epic 8
   * review P2); `null` when no Escrow coordinator is configured.
   */
  async getFundingPosition(
    record: FormWithVersion,
  ): Promise<EscrowFundingPosition | null> {
    return this.escrowCoordinator
      ? this.escrowCoordinator.getFundingPosition(
          record.form,
          record.form.publisherId,
        )
      : null;
  }

  /**
   * `MODERATION_QUEUE → PUBLISHED`: the pinned version becomes the live one
   * (`isPublished`, `publishedAt = approvedAt`).
   *
   * Epic 8 review P2: approval never trusts how the survey entered the queue
   * (a legacy `ESCROW_LOCKED` row, an older publish path). The stored version
   * must pass the publish validations (422 `FORM_VALIDATION_ERROR` /
   * `EXTERNAL_COMPLETION_CODE_REQUIRED`) and the Escrow the form holds must
   * fund its open quota (409 `MODERATION_ESCROW_NOT_FUNDED`, the Admin
   * rejects instead and the rejection refunds what it holds). Both checks
   * run inside the caller's Unit of Work, before any write.
   */
  async approvePublication(
    snapshot: FormWithVersion,
    approvedAt: Date,
  ): Promise<FormWithVersion | null> {
    if (!this.isQueued(snapshot)) {
      return null;
    }
    assertFormPublishable(snapshot.form, snapshot.currentVersion);
    const funding = await this.getFundingPosition(snapshot);
    if (funding && funding.shortfall > 0) {
      throw new ModerationEscrowNotFundedException(
        snapshot.form.id,
        funding.shortfall,
      );
    }
    const approvedForm = snapshot.form.transitionTo('PUBLISHED', approvedAt);
    const approvedVersion = snapshot.currentVersion.copyWith({
      isPublished: true,
      publishedAt: approvedAt,
    });
    return this.formRepository.update(approvedForm, approvedVersion, {
      status: 'MODERATION_QUEUE',
      updatedAt: snapshot.form.updatedAt,
    });
  }

  /**
   * `MODERATION_QUEUE → CLOSED` plus the Escrow refund (Research `CloseForm`
   * + Economy `RefundUnusedEscrow`, key `close-refund:{formId}:c{closeCount}`,
   * Epic 6 review P3). The transition runs first, so a lost race never
   * refunds.
   */
  async rejectPublication(
    snapshot: FormWithVersion,
    rejectedAt: Date,
  ): Promise<PublicationRejectionResult | null> {
    if (!this.isQueued(snapshot)) {
      return null;
    }
    // Decision E8-D1: a moderation rejection is final (never reopenable).
    const closedForm = snapshot.form.close('MODERATION', rejectedAt);
    const record = await this.formRepository.update(closedForm, undefined, {
      status: 'MODERATION_QUEUE',
      updatedAt: snapshot.form.updatedAt,
    });
    if (!record) {
      return null;
    }

    const refund = this.escrowCoordinator
      ? await this.escrowCoordinator.coordinateClose(
          closedForm,
          snapshot.form.publisherId,
        )
      : NO_REFUND;
    return { record, refund };
  }

  private isQueued(snapshot: FormWithVersion): boolean {
    return snapshot.form.status === 'MODERATION_QUEUE';
  }
}
