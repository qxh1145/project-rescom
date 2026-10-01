import {
  AttemptOutcomeDto,
  AttemptPinnedFormDto,
  AttemptRewardDto,
  AttemptRewardState,
  AttemptStarterUnlockDto,
  CancelAttemptResponseDto,
  EXTERNAL_COMPLETION_REVIEW_HOURS,
  LedgerAccountClass,
  RESERVATION_EXPIRY_MS,
  RewardSettlementResultDto,
  SurveyAttemptDetailsDto,
  SurveySummaryDto,
  parseFormDefinitionDraft,
  resolveEstimatedEffortSeconds,
  toRespondentFormBlocks,
} from '@rescom/schemas';
import { FormRepositoryPort } from '../../forms/application/ports/form-repository.port';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import { SurveyAttemptEntity } from '../domain/survey-attempt.entity';
import { ParticipationRepositoryPort } from './ports/participation-repository.port';
import { AttemptRewardQueryPort } from './ports/attempt-reward-query.port';
import { ParticipationRateLimiter } from './participation-rate-limiter';
import type { ParticipationLogger } from './participation.service';
import {
  describeAttemptTimeBarrier,
  findPinnedVersion,
  resolveTimeBarrier,
} from './attempt-projection';
import {
  AttemptNotFoundException,
  AttemptNotInProgressException,
  SurveyNotFoundException,
} from './exceptions/participation.exceptions';

/** FR-24: an External completion credit stays Pending for 48 hours. */
const PENDING_REVIEW_MS = EXTERNAL_COMPLETION_REVIEW_HOURS * 60 * 60 * 1000;

const NOT_ACTIVATED: AttemptStarterUnlockDto = Object.freeze({
  activatedByThisAttempt: false,
  amount: null,
  activatedAt: null,
});

export interface SurveyRunnerReadServiceDeps {
  formRepository: FormRepositoryPort;
  participationRepository: ParticipationRepositoryPort;
  /** AD-16: Economy's read-only reward and starter-unlock queries. */
  rewards: AttemptRewardQueryPort;
  /** Story 8.2: per-user burst limit of the cancel command; absent = none. */
  rateLimiter?: Pick<ParticipationRateLimiter, 'assertBurstAllowed'>;
  logger?: ParticipationLogger;
  now?: () => Date;
}

/** A reward without a credit journal (nothing was posted for the attempt). */
function rewardWithoutJournal(state: AttemptRewardState): AttemptRewardDto {
  return {
    state,
    amount: 0,
    targetAccountClass: null,
    journalId: null,
    creditedAt: null,
    releasesAt: null,
  };
}

/**
 * A reward read from its posted credit journal: the amount is the journal's
 * positive total, never the form's current price (Epic 6 review P5/P19).
 */
function rewardFromJournal(
  state: AttemptRewardState,
  credit: RewardSettlementResultDto & { journalId: string },
  targetAccountClass: LedgerAccountClass | null,
  releasesAt: string | null = null,
): AttemptRewardDto {
  return {
    state,
    amount: credit.amount,
    targetAccountClass,
    journalId: credit.journalId,
    creditedAt: credit.settledAt,
    releasesAt,
  };
}

function hasJournal(
  settlement: RewardSettlementResultDto | null,
): settlement is RewardSettlementResultDto & { journalId: string } {
  return settlement !== null && settlement.journalId !== null;
}

/**
 * Story IR.2a — the Respondent reads of the survey runner (API-01..API-05)
 * and the cancel command (API-03), owned by the Participation context.
 *
 * The reads are side-effect free: no lazy abandonment, no ledger posting, no
 * notification. An expired reservation is returned as persisted (IN_PROGRESS
 * with a past `expiresAt`); IR.2b's reservation-expiry job closes it durably.
 * The attempt routes are owner-only: unknown, guest and other users'
 * attempts are the same 404 ATTEMPT_NOT_FOUND.
 */
export class SurveyRunnerReadService {
  private readonly formRepository: FormRepositoryPort;
  private readonly participationRepository: ParticipationRepositoryPort;
  private readonly rewards: AttemptRewardQueryPort;
  private readonly rateLimiter?: Pick<
    ParticipationRateLimiter,
    'assertBurstAllowed'
  >;
  private readonly logger?: ParticipationLogger;
  private readonly now: () => Date;

  constructor(deps: SurveyRunnerReadServiceDeps) {
    this.formRepository = deps.formRepository;
    this.participationRepository = deps.participationRepository;
    this.rewards = deps.rewards;
    this.rateLimiter = deps.rateLimiter;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * API-01: public facts of a PUBLISHED survey with a published version. The
   * quota arithmetic is the attempt start's (completed + unexpired
   * reservations); effort follows BE-12 on the newest published version
   * (after "Create New Version" the newest row is a draft). Review LOW-8:
   * reads the form row and that version's metadata only.
   */
  async getSurveySummary(formId: string): Promise<SurveySummaryDto> {
    const summary = await this.formRepository.findPublishedSummaryById(formId);
    const published =
      summary && summary.form.isPublished() ? summary.newestPublished : null;
    if (!summary || !published) {
      throw new SurveyNotFoundException();
    }

    const { form } = summary;
    const { completedCount, activeReservationCount } =
      await this.participationRepository.getQuotaStatus(
        form.id,
        this.reservationCutoff(),
      );
    return {
      id: form.id,
      title: form.title,
      description: form.description,
      type: form.type,
      status: form.status,
      rewardPerResponse: form.rewardPerResponse,
      estimatedEffortSeconds: resolveEstimatedEffortSeconds({
        estimatedDurationMinutes: form.estimatedDurationMinutes,
        metadata: published.metadata,
      }),
      expectedCompletions: form.expectedCompletions,
      completedCompletions: completedCount,
      remainingSlots: Math.max(
        0,
        form.expectedCompletions - completedCount - activeReservationCount,
      ),
    };
  }

  /**
   * API-02 + API-05: the owner's attempt with everything taken from its
   * PINNED version (AD-19) — never the survey's current one: the Form
   * Definition (Internal), `versionNumber`, the Time Barrier, the Google
   * Form link (External) and the effort.
   */
  async getAttemptDetails(
    attemptId: string,
    callerUserId: string,
  ): Promise<SurveyAttemptDetailsDto> {
    const attempt = await this.loadOwnedAttempt(attemptId, callerUserId);
    const { form, pinned } = await this.loadPinnedVersion(attempt);
    const isInternal = form.type === 'INTERNAL';
    const pinnedForm = isInternal
      ? this.projectPinnedForm(attempt, pinned)
      : null;

    const [response, accountWrongCodeCount] = await Promise.all([
      isInternal
        ? this.participationRepository.findResponseByAttemptId(attempt.id)
        : Promise.resolve(null),
      // Decision E5-D1: reset-aware account+version total (External only).
      isInternal
        ? Promise.resolve(0)
        : this.participationRepository.countCompletionCodeFailures(
            callerUserId,
            attempt.formVersionId,
          ),
    ]);

    return {
      attemptId: attempt.id,
      responseId: response?.id ?? null,
      formId: attempt.surveyId,
      formVersionId: attempt.formVersionId,
      versionNumber: pinned.versionNumber,
      type: form.type,
      status: attempt.status,
      closedReason: attempt.closedReason,
      closedAt: attempt.closedAt?.toISOString() ?? null,
      startedAt: attempt.startedAt.toISOString(),
      expiresAt: new Date(
        attempt.startedAt.getTime() + RESERVATION_EXPIRY_MS,
      ).toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      wrongCodeCount: attempt.codeVerification.failedCount,
      accountWrongCodeCount,
      timeBarrier: describeAttemptTimeBarrier(
        resolveTimeBarrier(form.type, pinned),
        attempt.startedAt,
      ),
      survey: {
        title: form.title,
        status: form.status,
        rewardPerResponse: form.rewardPerResponse,
        estimatedEffortSeconds: resolveEstimatedEffortSeconds({
          estimatedDurationMinutes: form.estimatedDurationMinutes,
          metadata: pinned.schemaJson?.metadata,
        }),
        externalUrl: isInternal ? null : (pinned.externalUrl ?? null),
      },
      form: pinnedForm,
    };
  }

  /**
   * API-04: where the reward stands, derived only from posted Ledger
   * journals through Economy's read-only queries. Never settles, re-drives,
   * releases, unlocks or notifies; an attempt that is not COMPLETED reads
   * NOT_COMPLETED without any ledger read.
   */
  async getAttemptOutcome(
    attemptId: string,
    callerUserId: string,
  ): Promise<AttemptOutcomeDto> {
    const attempt = await this.loadOwnedAttempt(attemptId, callerUserId);
    if (attempt.status !== 'COMPLETED') {
      return this.toOutcome(
        attempt,
        rewardWithoutJournal('NOT_COMPLETED'),
        NOT_ACTIVATED,
      );
    }

    const formWithVersion = await this.formRepository.findById(
      attempt.surveyId,
    );
    if (!formWithVersion) {
      this.logger?.warn(
        `Survey attempt ${attempt.id}: its survey ${attempt.surveyId} was not found.`,
      );
      throw new AttemptNotFoundException();
    }
    const { form } = formWithVersion;
    const reward =
      form.type === 'INTERNAL'
        ? await this.internalReward(attempt)
        : await this.externalReward(attempt);
    const starterUnlock = await this.starterUnlockOf(
      attempt,
      form,
      callerUserId,
    );
    return this.toOutcome(attempt, reward, starterUnlock);
  }

  /**
   * API-03: abandons the owner's unexpired IN_PROGRESS attempt, releasing
   * its quota reservation, in one state-predicated transaction. A retry —
   * with the same or another `Idempotency-Key` — replays the original
   * `closedAt`; COMPLETED, LOCKED, otherwise abandoned and expired attempts
   * are 409 ATTEMPT_NOT_IN_PROGRESS. A reported missing code stays on the
   * row for the Admin (decision Q5).
   */
  async cancelAttempt(
    attemptId: string,
    callerUserId: string,
  ): Promise<CancelAttemptResponseDto> {
    // Review LOW-1: ownership first, so an unknown or foreign id (404) never
    // spends the caller's budget; then the cancel's own burst bucket (a
    // start/cancel loop is still bounded by the ATTEMPT_START bucket).
    const attempt = await this.loadOwnedAttempt(attemptId, callerUserId);
    await this.rateLimiter?.assertBurstAllowed(callerUserId, 'ATTEMPT_CANCEL', {
      attemptId: attempt.id,
    });

    const now = this.now();
    const result = await this.participationRepository.cancelAttempt({
      attemptId: attempt.id,
      respondentId: callerUserId,
      formId: attempt.surveyId,
      cutoffDate: new Date(now.getTime() - RESERVATION_EXPIRY_MS),
      now,
    });

    switch (result.outcome) {
      case 'NOT_FOUND':
        throw new AttemptNotFoundException();
      case 'NOT_IN_PROGRESS':
        throw new AttemptNotInProgressException({
          status: result.attempt.status,
          closedReason: result.derivedCloseReason,
        });
      case 'CANCELLED':
      case 'ALREADY_CANCELLED':
        return {
          attemptId: result.attempt.id,
          status: 'ABANDONED',
          closedReason: 'CANCELLED',
          closedAt: (result.attempt.closedAt ?? now).toISOString(),
        };
    }
  }

  /** Unknown, guest and other users' attempts are indistinguishable (404). */
  private async loadOwnedAttempt(
    attemptId: string,
    callerUserId: string,
  ): Promise<SurveyAttemptEntity> {
    const attempt =
      await this.participationRepository.findAttemptById(attemptId);
    if (!attempt || attempt.isGuest || attempt.respondentId !== callerUserId) {
      throw new AttemptNotFoundException();
    }
    return attempt;
  }

  /** A missing survey or pinned version is data corruption: 404 + warning. */
  private async loadPinnedVersion(
    attempt: SurveyAttemptEntity,
  ): Promise<{ form: FormEntity; pinned: FormVersionEntity }> {
    const formWithVersion = await this.formRepository.findById(
      attempt.surveyId,
    );
    const pinned = formWithVersion
      ? findPinnedVersion(formWithVersion, attempt.formVersionId)
      : null;
    if (!formWithVersion || !pinned) {
      this.logger?.warn(
        `Survey attempt ${attempt.id}: its survey or pinned version ${attempt.formVersionId} was not found.`,
      );
      throw new AttemptNotFoundException();
    }
    return { form: formWithVersion.form, pinned };
  }

  /**
   * API-05: the pinned Form Definition, parsed like the submit parses it
   * (same defaults as `GET /public/forms/:id`). An unusable definition is a
   * 404 + warning, as it would be for the submit. Review MEDIUM-1: the
   * Respondent projection — no block `integrity`, so the attention-check
   * answers stay server-side (the submit scores against the stored version).
   */
  private projectPinnedForm(
    attempt: SurveyAttemptEntity,
    pinned: FormVersionEntity,
  ): AttemptPinnedFormDto {
    const parsed = parseFormDefinitionDraft(pinned.schemaJson);
    if (!parsed.success || parsed.data.blocks.length === 0) {
      this.logger?.warn(
        `Survey attempt ${attempt.id}: the Form Definition of its pinned version ${pinned.id} is invalid or has no questions.`,
      );
      throw new AttemptNotFoundException();
    }
    const definition = parsed.data;
    return {
      formVersionId: pinned.id,
      versionNumber: pinned.versionNumber,
      title: definition.title,
      description: definition.description ?? null,
      blocks: toRespondentFormBlocks(definition.blocks),
      ...(definition.sections ? { sections: definition.sections } : {}),
      settings: definition.settings,
      metadata: definition.metadata,
      publishedAt: pinned.publishedAt?.toISOString() ?? null,
    };
  }

  /**
   * Internal: the `internal-reward:` journal (SHADOW/ADVISORY) or the
   * `integrity-hold:` one (ENFORCED). Without a journal, a positive pinned
   * reward request means the settlement failed after the submission
   * committed (re-driven by the owner's submit replay or the Admin).
   * Integrity-hold releases (`integrity-decision:`) are not looked up: Epic 10
   * decisions are deferred, so a held reward reads HELD_IN_INTEGRITY.
   * Review LOW-3: REVERSED is not derived for Internal either — nothing
   * reverses an internal reward until Epic 10, and Economy exposes no
   * internal reversal read yet; add it with the first reversal journal.
   */
  private async internalReward(
    attempt: SurveyAttemptEntity,
  ): Promise<AttemptRewardDto> {
    const response = await this.participationRepository.findResponseByAttemptId(
      attempt.id,
    );
    if (!response) {
      return rewardWithoutJournal('NO_REWARD');
    }
    const settlement = await this.rewards.findInternalSettlement(response.id);
    if (hasJournal(settlement)) {
      return settlement.status === 'HELD_IN_INTEGRITY'
        ? rewardFromJournal('HELD_IN_INTEGRITY', settlement, 'INTEGRITY_HOLD')
        : rewardFromJournal('AVAILABLE', settlement, 'USER_AVAILABLE');
    }
    const request =
      await this.participationRepository.findInternalRewardRequest(response.id);
    return rewardWithoutJournal(
      request && request.rewardAmount > 0 ? 'AWAITING_SETTLEMENT' : 'NO_REWARD',
    );
  }

  /**
   * External: the `external-completion:` credit and its settlement state.
   * Amount, journal and credit time always come from the credit journal,
   * including after a release, a dispute or a reversal.
   */
  private async externalReward(
    attempt: SurveyAttemptEntity,
  ): Promise<AttemptRewardDto> {
    const credit = await this.rewards.findExternalSettlement(attempt.id);
    if (!hasJournal(credit)) {
      return rewardWithoutJournal('NO_REWARD');
    }
    switch (await this.rewards.getExternalSettlementState(attempt.id)) {
      case 'PENDING':
        return rewardFromJournal(
          'PENDING',
          credit,
          'PENDING',
          new Date(
            Date.parse(credit.settledAt) + PENDING_REVIEW_MS,
          ).toISOString(),
        );
      case 'RELEASED':
        return rewardFromJournal('AVAILABLE', credit, 'USER_AVAILABLE');
      case 'HELD':
        return rewardFromJournal('HELD_IN_DISPUTE', credit, 'PENDING');
      case 'REVERSED':
      case 'REFUNDED_TO_PUBLISHER':
        return rewardFromJournal('REVERSED', credit, null);
      case 'NONE':
        return rewardWithoutJournal('NO_REWARD');
    }
  }

  /**
   * Story 7.2: this attempt activated the account when the shared rule
   * attributes the starter unlock to its logical Form and source — one
   * completion per account and logical Form (FR-25) makes the pair unique.
   * An External completion only activates after its 48 h review.
   */
  private async starterUnlockOf(
    attempt: SurveyAttemptEntity,
    form: FormEntity,
    callerUserId: string,
  ): Promise<AttemptStarterUnlockDto> {
    const snapshot = await this.rewards.getActivationSnapshot(callerUserId);
    const survey = snapshot.activationSurvey;
    if (
      !snapshot.unlockedAt ||
      snapshot.amount === null ||
      survey?.formId !== attempt.surveyId ||
      survey.source !== form.type
    ) {
      return NOT_ACTIVATED;
    }
    return {
      activatedByThisAttempt: true,
      amount: snapshot.amount,
      activatedAt: snapshot.unlockedAt.toISOString(),
    };
  }

  private toOutcome(
    attempt: SurveyAttemptEntity,
    reward: AttemptRewardDto,
    starterUnlock: AttemptStarterUnlockDto,
  ): AttemptOutcomeDto {
    return {
      attemptId: attempt.id,
      attemptStatus: attempt.status,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      reward,
      accountActivated: starterUnlock.activatedByThisAttempt,
      starterUnlock: { ...starterUnlock },
    };
  }

  private reservationCutoff(): Date {
    return new Date(this.now().getTime() - RESERVATION_EXPIRY_MS);
  }
}
