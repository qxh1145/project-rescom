import {
  calculateEscrowCost,
  EscrowCostCalculationResult,
  escrowDrawPerCompletion,
} from '@rescom/schemas';
import { FormRepositoryPort } from './ports/form-repository.port';
import { LedgerService } from '../../economy/application/ledger.service';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';

export interface PublishEscrowResult {
  journalId: string | null;
  costCalculation: EscrowCostCalculationResult;
  /** Points this publication actually locked (the funding shortfall). */
  reservedAmount: number;
}

export interface CloseEscrowResult {
  refundJournalId: string | null;
  /** Idempotency key of the posted refund journal (null when none). */
  refundIdempotencyKey: string | null;
  refundAmount: number;
  unusedCompletions: number;
}

/**
 * How well a survey's open quota is funded by the Escrow it holds (Epic 8
 * review P2). All values are 0 for a free survey.
 */
export interface EscrowFundingPosition {
  /** Open quota slots × per-completion draw. */
  required: number;
  /** What the form still holds in Escrow (never negative). */
  held: number;
  /** `max(0, required − held)`: what a publication must still reserve. */
  shortfall: number;
}

export interface ReopenEscrowResult {
  reopenJournalId: string | null;
  additionalCost: number;
}

/**
 * The Escrow a logical form still holds, from its own journals (Epic 6
 * review P4). One ESCROW account is pooled per Publisher, so the account
 * balance cannot tell surveys apart.
 */
interface FormEscrowState {
  /** reserved − refunded − consumed − owed (negative when over-drawn). */
  remaining: number;
  /** Completed participations (quota definition, guests included). */
  completedCount: number;
  /** Points one completion draws (decision D1, `escrowDrawPerCompletion`). */
  draw: number;
}

/**
 * Research-side coordinator of the survey Escrow lifecycle (FR-15, FR-32,
 * FR-33, AD-16). Every command runs inside the caller's Unit of Work, so the
 * journal and the form transition commit or roll back together.
 *
 * Escrow accounting per logical form (Epic 6 review P4):
 * - `reserved` = `publish:{versionId}` of every version + `reopen-escrow:{formId}:*`
 * - `refunded` = `close-refund:{formId}:*`
 * - `consumed` = Escrow debits of the form's payout journals
 *   (`internal-reward:` / `integrity-hold:` / `external-completion:`)
 * - `owed`     = rewardable completions without a payout journal yet × draw
 *   (a committed completion whose settlement is still pending, P5).
 */
export class FormsEscrowCoordinator {
  constructor(
    private readonly formRepository: FormRepositoryPort,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Calculates the escrow cost quote for a given form configuration (FR-15, FR-19).
   */
  getEscrowQuote(form: {
    type: FormEntity['type'];
    expectedCompletions: number;
    rewardPerResponse: number;
  }): EscrowCostCalculationResult {
    return calculateEscrowCost({
      type: form.type,
      expectedCompletions: form.expectedCompletions,
      rewardPerResponse: form.rewardPerResponse,
    });
  }

  /**
   * Coordinated Escrow reservation on Form Version publication (FR-15, AD-16).
   * Stable idempotency key: `publish:${formVersionId}`.
   *
   * A first publication locks `expectedCompletions × draw`. A re-publication
   * (new version of a live survey) locks only the shortfall: the slots still
   * open times the draw, minus what the form already holds in Escrow — the
   * earlier version's Escrow is carried over instead of stranded (P4).
   */
  async coordinatePublish(
    form: FormEntity,
    version: FormVersionEntity,
    publisherId: string,
  ): Promise<PublishEscrowResult> {
    const costCalculation = this.getEscrowQuote(form);

    let journalId: string | null = null;
    let reservedAmount = 0;
    if (costCalculation.effectiveCost > 0) {
      const { shortfall } = await this.getFundingPosition(form, publisherId, [
        version.id,
      ]);

      const journal = await this.ledgerService.reserveEscrow({
        userId: publisherId,
        formVersionId: version.id,
        amount: shortfall,
        formTitle: form.title,
      });
      if (journal) {
        journalId = journal.id;
        reservedAmount = journal.entries
          .filter((entry) => entry.amount > 0)
          .reduce((sum, entry) => sum + entry.amount, 0);
      }
    }

    return {
      journalId,
      costCalculation,
      reservedAmount,
    };
  }

  /**
   * The funding of the form's open quota by the Escrow it holds (Epic 8
   * review P2): `required = open slots × draw`, `held = max(0, remaining)`,
   * `shortfall = max(0, required − held)`. Publication reserves the
   * shortfall; queue entry of a legacy row and moderation approval require it
   * to be 0. A free survey (effective cost 0) needs no Escrow.
   * `extraVersionIds`: versions not persisted yet whose `publish:` journal
   * counts (auto-publish creates the version in the same Unit of Work).
   */
  async getFundingPosition(
    form: FormEntity,
    publisherId: string,
    extraVersionIds: string[] = [],
  ): Promise<EscrowFundingPosition> {
    if (this.getEscrowQuote(form).effectiveCost <= 0) {
      return { required: 0, held: 0, shortfall: 0 };
    }
    const state = await this.loadEscrowState(
      form,
      publisherId,
      extraVersionIds,
    );
    const openSlots = Math.max(
      0,
      form.expectedCompletions - state.completedCount,
    );
    const required = openSlots * state.draw;
    const held = Math.max(0, state.remaining);
    return { required, held, shortfall: Math.max(0, required - held) };
  }

  /**
   * Coordinated Escrow refund on Form closure (FR-32, AD-16). The caller runs
   * it inside the same Unit of Work as the Form's close transition and passes
   * the form **as closed** (its new `closeCount`).
   * Idempotency key: `close-refund:${formId}:c${closeCount}` (P3).
   *
   * Refunds everything the form still holds in Escrow: reserved − refunded −
   * consumed − owed. This covers a live close (the unused quota, External
   * completions included), a moderation rejection / withdrawal of a first
   * publication (its whole reservation) or of a re-publication (everything
   * left on the form), guest-filled slots (never paid) and legacy forms
   * without a reservation (nothing to refund — another survey's Escrow in
   * the pooled account is never released).
   */
  async coordinateClose(
    closedForm: FormEntity,
    publisherId: string,
  ): Promise<CloseEscrowResult> {
    const state = await this.loadEscrowState(closedForm, publisherId);
    // Open quota slots, capped by what the Escrow still funds (slots an
    // earlier close already refunded are not counted again).
    const openSlots = Math.max(
      0,
      closedForm.expectedCompletions - state.completedCount,
    );
    const unusedCompletions =
      state.draw > 0
        ? Math.min(
            openSlots,
            Math.floor(Math.max(0, state.remaining) / state.draw),
          )
        : openSlots;
    const closeVersion = closeIdentity(closedForm.closeCount);

    // A replay of this close returns its original refund journal.
    const journal =
      (await this.ledgerService.findJournalByIdempotencyKey(
        `close-refund:${closedForm.id}:${closeVersion}`,
      )) ??
      (state.remaining > 0
        ? await this.ledgerService.refundUnusedEscrow({
            userId: publisherId,
            formId: closedForm.id,
            closeVersion,
            unusedAmount: state.remaining,
            unusedCompletions,
            formTitle: closedForm.title,
          })
        : null);

    return {
      refundJournalId: journal?.id ?? null,
      refundIdempotencyKey: journal?.idempotencyKey ?? null,
      refundAmount: journal
        ? journal.entries
            .filter((entry) => entry.amount > 0)
            .reduce((sum, entry) => sum + entry.amount, 0)
        : 0,
      unusedCompletions,
    };
  }

  /**
   * Coordinated Escrow lock when reopening a closed survey with additional
   * quota (FR-33: "new Escrow is calculated for the additional slots only").
   * Idempotency key: `reopen-escrow:${formId}:c${closeCount}` — one reopen
   * per close (P3). `closedForm` is the form still CLOSED.
   */
  async coordinateReopen(
    closedForm: FormEntity,
    publisherId: string,
    additionalCompletions: number,
  ): Promise<ReopenEscrowResult> {
    const additionalCost =
      additionalCompletions * escrowDrawPerCompletion(closedForm);

    let reopenJournalId: string | null = null;
    if (additionalCost > 0) {
      const journal = await this.ledgerService.reopenEscrow({
        userId: publisherId,
        formId: closedForm.id,
        reopenVersion: closeIdentity(closedForm.closeCount),
        additionalAmount: additionalCost,
        formTitle: closedForm.title,
      });
      reopenJournalId = journal.id;
    }

    return {
      reopenJournalId,
      additionalCost,
    };
  }

  private async loadEscrowState(
    form: FormEntity,
    publisherId: string,
    extraVersionIds: string[] = [],
  ): Promise<FormEscrowState> {
    const [versions, completions] = await Promise.all([
      this.formRepository.findAllVersions(form.id),
      this.formRepository.listRewardableCompletions(form.id),
    ]);
    const versionIds = Array.from(
      new Set([...versions.map((version) => version.id), ...extraVersionIds]),
    );

    const position = await this.ledgerService.getFormEscrowPosition({
      publisherId,
      formId: form.id,
      versionIds,
      internalResponseIds: completions.internalResponses.map(
        (response) => response.id,
      ),
      externalAttemptIds: completions.externalAttemptIds,
    });

    const draw = escrowDrawPerCompletion(form);
    const unsettled =
      completions.internalResponses.filter(
        (response) =>
          response.rewardable && !position.settledResponseIds.has(response.id),
      ).length +
      completions.externalAttemptIds.filter(
        (attemptId) => !position.settledAttemptIds.has(attemptId),
      ).length;

    return {
      remaining:
        position.reserved -
        position.refunded -
        position.consumed -
        unsettled * draw,
      completedCount: completions.completedCount,
      draw,
    };
  }
}

/**
 * Close identity of the Escrow keys (Epic 6 review P3). The `c` prefix keeps
 * new keys apart from the legacy `{versionNumber}` ones.
 */
export function closeIdentity(closeCount: number): string {
  return `c${closeCount}`;
}
