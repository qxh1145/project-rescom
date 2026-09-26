import {
  ActivationSurveySource,
  decodeStarterPointsExpiryCursor,
  encodeStarterPointsExpiryCursor,
  evaluateStarterActivation,
  EXTERNAL_COMPLETION_REVIEW_HOURS,
  expireStarterPointsSchema,
  ExpireStarterPointsResultDto,
  getStarterPointsExpiresAt,
  STARTER_POINTS_DEFAULT_AMOUNT,
  STARTER_POINTS_EXPIRY_DAYS,
  StarterActivationEvaluation,
  StarterPointsStatusDto,
  StarterPointsUnlockResultDto,
} from '@rescom/schemas';
import { LedgerService } from './ledger.service';
import { InvalidLedgerOperationException } from './exceptions/economy.exceptions';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';

/**
 * One Marketplace survey completion that may count toward activation
 * (Story 7.2, FR-7): an authenticated completion of a survey published by
 * someone else that pays at least 1 point per response (decision E7-DN2,
 * option B(1)). Internal = VALIDATED Response, External = COMPLETED Attempt.
 */
export interface ActivationSurveyCompletionRecord {
  source: ActivationSurveySource;
  formId: string;
  /** External: the attempt whose `external-completion:{attemptId}` credit may be reversed. */
  attemptId: string | null;
  completedAt: Date;
  /** The survey's reward per response (re-checked by `evaluateStarterActivation`). */
  rewardPerResponse: number;
}

export interface FindActivationCompletionsOptions {
  /**
   * Only completions at or before this time. The coordinator passes "now":
   * the shared rule itself keeps only in-window completions (FR-5) for the
   * unlock, while any confirmed completion makes a "Verified Member"
   * (decision E7-DN3).
   */
  completedBefore: Date;
  /** Oldest completions first, at most `limit` per source (Internal / External). */
  limit: number;
}

/** A place in the expiry sweep order: (registration date, user id). */
export interface StarterPointsExpiryPosition {
  registeredAt: Date;
  userId: string;
}

export interface FindUsersForExpiryOptions {
  /** At most this many candidates. */
  limit: number;
  /** Only candidates strictly after this position; `null` = from the start. */
  after: StarterPointsExpiryPosition | null;
}

export interface StarterPointsUserDataProvider {
  getUserRegistrationDate(userId: string): Promise<Date | null>;
  isDemographicComplete(userId: string): Promise<boolean>;
  findActivationSurveyCompletions(
    userId: string,
    options: FindActivationCompletionsOptions,
  ): Promise<ActivationSurveyCompletionRecord[]>;
  /**
   * Users registered on or before `cutoffDate` who may still hold Frozen
   * points, ordered by (registration date, user id) — the registration date
   * being the one `getUserRegistrationDate` returns, which positions the
   * sweep's cursor.
   */
  findUsersForExpiry(
    cutoffDate: Date,
    options: FindUsersForExpiryOptions,
  ): Promise<string[]>;
}

/** One expiry-sweep request: a bounded batch after an optional cursor. */
export interface ExpireStarterPointsBatchOptions {
  /** Candidates scanned (default 100, at most 500). */
  limit?: number;
  /** `nextCursor` of the previous batch; omitted = from the oldest registration. */
  after?: string;
}

/** Framework-free sink for swallowed failures (Nest `Logger` in the module). */
export interface StarterPointsLogger {
  warn(message: string): void;
}

/** What asked for the unlock check — only used for diagnostics. */
export type StarterPointsUnlockTrigger =
  | 'DEMOGRAPHICS'
  | 'INTERNAL_SUBMISSION'
  | 'EXTERNAL_VERIFICATION'
  | 'PENDING_RELEASE'
  | 'MANUAL';

/** Shared contract of `POST /economy/starter-points/unlock` (`@rescom/schemas`). */
export type CheckAndUnlockStarterPointsResult = StarterPointsUnlockResultDto;

/**
 * Completions fetched per source on the first lookup (only one is needed).
 * When every fetched External completion is disqualified by its settlement
 * state, the lookup doubles (review 3.5) up to
 * `ACTIVATION_COMPLETIONS_MAX_LOOKUP_LIMIT`.
 */
export const ACTIVATION_COMPLETIONS_LOOKUP_LIMIT = 20;
export const ACTIVATION_COMPLETIONS_MAX_LOOKUP_LIMIT = 320;

/**
 * How long after its source journal a lost notification may still be
 * re-published by a later trigger (Epic 9 review P1/P7). Outside the window
 * nothing is published or written, so an old activation or expiry never
 * produces a notice dated "now". Notifications are best-effort (see
 * `deferred-work.md`, Story 9.6 Outbox item); this bounds the recovery.
 */
export const NOTIFICATION_RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const EXPIRED_REASON =
  'Starter points have expired past the 30-day onboarding window.';
const ALREADY_UNLOCKED_REASON = 'Starter points already unlocked.';

interface ActivationSnapshot {
  registeredAt: Date;
  isGranted: boolean;
  frozenBalance: number;
  isDemographicComplete: boolean;
  unlockJournal: LedgerJournalEntity | null;
  expiryJournal: LedgerJournalEntity | null;
  evaluation: StarterActivationEvaluation;
}

function grantKey(userId: string): string {
  return `starter-grant:${userId}`;
}

function unlockKey(userId: string): string {
  return `starter-unlock:${userId}`;
}

function expiryKey(userId: string): string {
  return `starter-expiry:${userId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starter-points lifecycle (Story 6.5) and the Marketplace activation step
 * (Story 7.2). The activation rule itself is the shared pure
 * `evaluateStarterActivation` (`@rescom/schemas`), so the frontend mock and
 * this coordinator decide the same way. Every point movement goes through
 * `LedgerService` with one idempotency key per user:
 * `starter-grant:` (ISSUANCE → FROZEN), `starter-unlock:` (FROZEN → AVAILABLE)
 * and `starter-expiry:` (FROZEN → SINK). Unlock and expiry both debit FROZEN,
 * which can never go negative, so at most one of them ever posts.
 */
export class StarterPointsCoordinator {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly dataProvider: StarterPointsUserDataProvider,
    private readonly notificationPublisher?: NotificationPublisherPort,
    private readonly logger?: StarterPointsLogger,
  ) {}

  /**
   * Grants initial starter points (100 FROZEN) upon user registration (FR-4, AD-16).
   */
  async grantStarterPoints(
    userId: string,
    amount: number = STARTER_POINTS_DEFAULT_AMOUNT,
  ): Promise<{ granted: boolean; journalId: string }> {
    const journal = await this.ledgerService.grantStarterPoints(userId, amount);
    return {
      granted: true,
      journalId: journal.id,
    };
  }

  /**
   * Self-healing starter grant (FR-4). The grant runs after the account row
   * commits, so a failed grant is recovered by the next login, status read or
   * unlock trigger. Grants only while the user has neither a `starter-grant:`
   * nor a `starter-expiry:` journal and is inside the 30-day window of a
   * known registration date. Idempotent (keyed journal) and never throws: a
   * failure is logged and retried by the next caller. Resolves `true` when
   * this call posted (or converged on) the grant.
   */
  async ensureStarterGrant(userId: string): Promise<boolean> {
    try {
      const settled =
        (await this.ledgerService.findJournalByIdempotencyKey(
          grantKey(userId),
        )) ??
        (await this.ledgerService.findJournalByIdempotencyKey(
          expiryKey(userId),
        ));
      if (settled) {
        return false;
      }

      const registeredAt =
        await this.dataProvider.getUserRegistrationDate(userId);
      if (
        !registeredAt ||
        Date.now() > getStarterPointsExpiresAt(registeredAt).getTime()
      ) {
        return false;
      }

      await this.ledgerService.grantStarterPoints(userId);
      return true;
    } catch (error) {
      this.logger?.warn(
        `Starter points grant failed for user ${userId}; the next login or status check will retry: ${errorMessage(error)}`,
      );
      return false;
    }
  }

  /**
   * Current onboarding / activation status for a user (FR-4, FR-5, FR-7, FR-8).
   * Recovers a missing starter grant first; otherwise read-only: clients call
   * `checkAndUnlockStarterPoints` when the state is `READY_TO_UNLOCK`.
   */
  async getStatus(userId: string): Promise<StarterPointsStatusDto> {
    await this.ensureStarterGrant(userId);
    const snapshot = await this.loadSnapshot(userId, new Date());
    const { evaluation } = snapshot;

    return {
      userId,
      isGranted: snapshot.isGranted,
      frozenBalance: snapshot.frozenBalance,
      isDemographicComplete: snapshot.isDemographicComplete,
      hasCompletedMarketplaceSurvey: evaluation.hasQualifyingSurvey,
      isUnlocked: evaluation.isUnlocked,
      isExpired: evaluation.isExpired,
      registeredAt: snapshot.registeredAt.toISOString(),
      expiresAt: evaluation.expiresAt.toISOString(),
      daysRemaining: evaluation.daysRemaining,
      unlockEligibility: {
        eligible: evaluation.eligible,
        missingSteps: evaluation.missingSteps,
      },
      activationState: evaluation.state,
      activatedAt: snapshot.unlockJournal
        ? snapshot.unlockJournal.createdAt.toISOString()
        : null,
      activationSurvey: evaluation.activationSurvey,
      isVerifiedMember: evaluation.isVerifiedMember,
    };
  }

  /**
   * Unlocks the starter points FROZEN → USER_AVAILABLE when the activation
   * step is complete (FR-8, AD-16). Exactly once: the journal is keyed
   * `starter-unlock:{userId}`, concurrent callers converge on the same
   * journal, and an already-unlocked account only re-publishes the
   * (deduplicated) activation notification to recover a lost one — and only
   * within `NOTIFICATION_RECOVERY_WINDOW_MS` of the unlock (Epic 9 review
   * P1). An expired account likewise recovers a lost expiry WARNING within
   * the window (P7).
   */
  async checkAndUnlockStarterPoints(
    userId: string,
  ): Promise<CheckAndUnlockStarterPointsResult> {
    const existing = await this.ledgerService.findJournalByIdempotencyKey(
      unlockKey(userId),
    );
    if (existing) {
      if (this.isWithinRecoveryWindow(existing)) {
        await this.publishActivated(userId, existing);
      }
      return {
        unlocked: false,
        reason: ALREADY_UNLOCKED_REASON,
        activationState: 'ACTIVATED',
      };
    }

    const { evaluation, frozenBalance, expiryJournal } =
      await this.loadSnapshot(userId, new Date());

    if (evaluation.state === 'EXPIRED') {
      if (expiryJournal && this.isWithinRecoveryWindow(expiryJournal)) {
        await this.publishExpired(userId, expiryJournal);
      }
      return {
        unlocked: false,
        reason: EXPIRED_REASON,
        activationState: 'EXPIRED',
      };
    }

    if (!evaluation.eligible) {
      return {
        unlocked: false,
        missingSteps: evaluation.missingSteps,
        reason: this.describeIneligibility(evaluation),
        activationState: evaluation.state,
      };
    }

    // The starter grant is 100; unlock what is actually Frozen, capped at it.
    const unlockAmount = Math.min(frozenBalance, STARTER_POINTS_DEFAULT_AMOUNT);
    let journal: LedgerJournalEntity;
    try {
      journal = await this.ledgerService.unlockStarterPoints(
        userId,
        unlockAmount,
      );
    } catch (error) {
      // The expiry sweep may have voided the Frozen points between our
      // evaluation and the ledger post: FR-5 won, FR-8 must not apply.
      const expiry = await this.ledgerService.findJournalByIdempotencyKey(
        expiryKey(userId),
      );
      if (expiry) {
        if (this.isWithinRecoveryWindow(expiry)) {
          await this.publishExpired(userId, expiry);
        }
        return {
          unlocked: false,
          reason: EXPIRED_REASON,
          activationState: 'EXPIRED',
        };
      }
      throw error;
    }

    await this.publishActivated(userId, journal);

    return {
      unlocked: true,
      amount: this.creditedAmount(journal),
      journalId: journal.id,
      activationState: 'ACTIVATED',
    };
  }

  /**
   * Unlock check for callers whose own transaction already committed
   * (survey submission, completion-code verification, profile save, pending
   * release). Never throws: a failure is logged and retried by the next
   * trigger, `POST /economy/starter-points/unlock`, or the expiry sweep's
   * catch-up — it must never fail the respondent's request.
   */
  async tryUnlockStarterPoints(
    userId: string,
    trigger: StarterPointsUnlockTrigger,
  ): Promise<CheckAndUnlockStarterPointsResult> {
    await this.ensureStarterGrant(userId);
    try {
      return await this.checkAndUnlockStarterPoints(userId);
    } catch (error) {
      this.logger?.warn(
        `Starter points unlock check failed for user ${userId} (trigger: ${trigger}); a later trigger will retry: ${errorMessage(error)}`,
      );
      return {
        unlocked: false,
        reason: 'Starter points unlock check failed; it will be retried.',
      };
    }
  }

  /**
   * One batch of the expiry sweep (FR-5, AD-16) over users registered on or
   * before `cutoffDate` (default: now − 30 days) who still hold Frozen points,
   * oldest registration first: at most `limit` candidates after the `after`
   * cursor. Per user, using the same activation rule as the unlock:
   * - still inside their own 30-day window → skipped (a cutoff only narrows);
   * - activated / nothing to activate → skipped;
   * - an in-window qualifying survey → catch-up unlock instead of expiry;
   * - an in-window External survey still under review → deferred;
   * - otherwise → Frozen points voided to SYSTEM_SINK + WARNING notification.
   * One user's failure is counted and logged; the sweep continues. The
   * returned `nextCursor` lies after every scanned candidate, so deferred,
   * caught-up and failed users never block the next batch (a new sweep from
   * the start retries them).
   */
  async expireUnmaturedStarterPoints(
    cutoffDate?: Date,
    batch: ExpireStarterPointsBatchOptions = {},
  ): Promise<ExpireStarterPointsResultDto> {
    const now = new Date();
    const effectiveCutoff =
      cutoffDate ??
      new Date(
        now.getTime() - STARTER_POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      );

    const page = expireStarterPointsSchema.safeParse({
      limit: batch.limit,
      after: batch.after,
    });
    if (!page.success) {
      throw new InvalidLedgerOperationException(
        page.error.errors[0]?.message ?? 'Invalid starter points expiry batch.',
      );
    }
    const { limit } = page.data;
    const after = page.data.after
      ? decodeStarterPointsExpiryCursor(page.data.after)
      : null;

    const candidateUserIds = await this.dataProvider.findUsersForExpiry(
      effectiveCutoff,
      {
        limit,
        after: after && {
          registeredAt: new Date(after.registeredAt),
          userId: after.userId,
        },
      },
    );

    const expiredUserIds: string[] = [];
    const unlockedUserIds: string[] = [];
    let totalPointsVoided = 0;
    let deferredCount = 0;
    let failedCount = 0;

    for (const candidateId of candidateUserIds) {
      try {
        const snapshot = await this.loadSnapshot(candidateId, now);
        const { evaluation } = snapshot;

        if (!evaluation.isDeadlinePassed || snapshot.expiryJournal) {
          continue;
        }

        if (evaluation.state === 'READY_TO_UNLOCK') {
          const result = await this.checkAndUnlockStarterPoints(candidateId);
          if (result.unlocked) {
            unlockedUserIds.push(candidateId);
          }
          continue;
        }

        if (evaluation.state === 'PENDING_CONFIRMATION') {
          deferredCount++;
          continue;
        }

        // Same rule as the status API: only an EXPIRED evaluation is voided
        // (ACTIVATED / NOT_GRANTED are skipped).
        if (!evaluation.isExpired) {
          continue;
        }

        const journal = await this.expireFrozenPoints(candidateId);
        if (!journal) {
          continue;
        }

        expiredUserIds.push(candidateId);
        totalPointsVoided += this.voidedAmount(journal);

        await this.publishExpired(candidateId, journal);
      } catch (error) {
        failedCount++;
        this.logger?.warn(
          `Starter points expiry sweep failed for user ${candidateId}; the next sweep will retry: ${errorMessage(error)}`,
        );
      }
    }

    const lastCandidateId = candidateUserIds[candidateUserIds.length - 1];
    const nextCursor =
      candidateUserIds.length < limit
        ? null
        : await this.expiryCursorAfter(lastCandidateId);

    return {
      scannedCount: candidateUserIds.length,
      expiredCount: expiredUserIds.length,
      expiredUserIds,
      totalPointsVoided,
      unlockedUserIds,
      deferredCount,
      failedCount,
      timestamp: now.toISOString(),
      nextCursor,
    };
  }

  /** The sweep position just after `userId` (a candidate just scanned). */
  private async expiryCursorAfter(userId: string): Promise<string> {
    const registeredAt =
      await this.dataProvider.getUserRegistrationDate(userId);
    if (!registeredAt) {
      throw new Error(
        `Starter points expiry sweep cannot continue after user ${userId}: registration date not found.`,
      );
    }
    return encodeStarterPointsExpiryCursor({
      registeredAt: registeredAt.toISOString(),
      userId,
    });
  }

  /**
   * Posts the expiry journal, unless an unlock won a concurrent race (the
   * ledger then rejects the FROZEN debit and the unlock journal exists).
   */
  private async expireFrozenPoints(
    userId: string,
  ): Promise<LedgerJournalEntity | null> {
    try {
      return await this.ledgerService.expireStarterPoints(userId);
    } catch (error) {
      const unlock = await this.ledgerService.findJournalByIdempotencyKey(
        unlockKey(userId),
      );
      if (unlock) {
        return null;
      }
      throw error;
    }
  }

  private async loadSnapshot(
    userId: string,
    now: Date,
  ): Promise<ActivationSnapshot> {
    const registeredAt =
      (await this.dataProvider.getUserRegistrationDate(userId)) ?? now;

    const [grantJournal, unlockJournal, expiryJournal, accounts] =
      await Promise.all([
        this.ledgerService.findJournalByIdempotencyKey(grantKey(userId)),
        this.ledgerService.findJournalByIdempotencyKey(unlockKey(userId)),
        this.ledgerService.findJournalByIdempotencyKey(expiryKey(userId)),
        this.ledgerService.getUserAccounts(userId),
      ]);

    const frozenBalance = accounts
      .filter((account) => account.accountClass === 'FROZEN')
      .reduce((sum, account) => sum + account.balance, 0);

    const isDemographicComplete =
      await this.dataProvider.isDemographicComplete(userId);
    // Every completion up to now: the rule counts only in-window ones for the
    // unlock (FR-5); a later one still makes a Verified Member (E7-DN3).
    // Oldest first, so in-window completions are never crowded out.
    const completions = await this.findCountableCompletions(
      userId,
      getStarterPointsExpiresAt(registeredAt),
      now,
    );

    const isGranted = Boolean(grantJournal) || frozenBalance > 0;

    return {
      registeredAt,
      isGranted,
      frozenBalance,
      isDemographicComplete,
      unlockJournal,
      expiryJournal,
      evaluation: evaluateStarterActivation({
        now,
        registeredAt,
        isGranted,
        frozenBalance,
        isDemographicComplete,
        completions,
        unlockedAt: unlockJournal?.createdAt ?? null,
        expiredAt: expiryJournal?.createdAt ?? null,
      }),
    };
  }

  /**
   * Eligible completions made up to `now`, keeping an External completion
   * only while its ledger credit exists and is Pending or Released (review
   * 3.5): a missing credit (zero reward, escrow shortfall, failed settlement),
   * an open dispute hold, a Publisher refund or a reversal disqualifies it.
   * Past the 30-day `deadline` a completion only matters for "Verified
   * Member" (E7-DN3), where one confirmed completion is enough: at most one
   * is kept and still-under-review late ones are skipped, which bounds the
   * per-completion ledger lookups for expired accounts.
   *
   * The settlement filter runs before the lookup bound decides anything: when
   * a full page of External completions yields no countable in-window one,
   * the lookup doubles, so disqualified attempts never hide a valid later
   * one. Settlement states are cached across pages.
   */
  private async findCountableCompletions(
    userId: string,
    deadline: Date,
    now: Date,
  ): Promise<ActivationSurveyCompletionRecord[]> {
    const settled = new Map<string, boolean>();
    let limit = ACTIVATION_COMPLETIONS_LOOKUP_LIMIT;
    for (;;) {
      const completions =
        await this.dataProvider.findActivationSurveyCompletions(userId, {
          completedBefore: now,
          limit,
        });
      const countable = await this.filterCountableCompletions(
        completions,
        deadline,
        now,
        settled,
      );
      const externalPageFull =
        completions.filter((completion) => completion.source === 'EXTERNAL')
          .length >= limit;
      const hasInWindow = countable.some(
        (completion) => completion.completedAt.getTime() <= deadline.getTime(),
      );
      if (
        hasInWindow ||
        !externalPageFull ||
        limit >= ACTIVATION_COMPLETIONS_MAX_LOOKUP_LIMIT
      ) {
        return countable;
      }
      limit = Math.min(limit * 2, ACTIVATION_COMPLETIONS_MAX_LOOKUP_LIMIT);
    }
  }

  private async filterCountableCompletions(
    completions: ActivationSurveyCompletionRecord[],
    deadline: Date,
    now: Date,
    settled: Map<string, boolean>,
  ): Promise<ActivationSurveyCompletionRecord[]> {
    const reviewMs = EXTERNAL_COMPLETION_REVIEW_HOURS * 60 * 60 * 1000;
    const countable: ActivationSurveyCompletionRecord[] = [];
    let lateConfirmedKept = false;
    for (const completion of completions) {
      const late = completion.completedAt.getTime() > deadline.getTime();
      if (late) {
        if (lateConfirmedKept) continue;
        if (
          completion.source === 'EXTERNAL' &&
          completion.completedAt.getTime() + reviewMs > now.getTime()
        ) {
          continue;
        }
      }
      if (
        completion.source === 'EXTERNAL' &&
        !(await this.isExternalCreditCountable(completion.attemptId, settled))
      ) {
        continue;
      }
      countable.push(completion);
      if (late) lateConfirmedKept = true;
    }
    return countable;
  }

  private async isExternalCreditCountable(
    attemptId: string | null,
    settled: Map<string, boolean>,
  ): Promise<boolean> {
    if (!attemptId) {
      return false;
    }
    const cached = settled.get(attemptId);
    if (cached !== undefined) {
      return cached;
    }
    const state =
      await this.ledgerService.getExternalSettlementState(attemptId);
    const countable = state === 'PENDING' || state === 'RELEASED';
    settled.set(attemptId, countable);
    return countable;
  }

  private describeIneligibility(
    evaluation: StarterActivationEvaluation,
  ): string {
    if (evaluation.state === 'PENDING_CONFIRMATION') {
      return 'Waiting for the 48-hour review of your External survey completion.';
    }
    if (evaluation.missingSteps.length > 0) {
      return `Incomplete onboarding: ${evaluation.missingSteps.join(', ')}`;
    }
    return 'Account is not eligible for starter points unlock.';
  }

  private creditedAmount(journal: LedgerJournalEntity): number {
    return (
      journal.entries.find((entry) => entry.amount > 0)?.amount ??
      STARTER_POINTS_DEFAULT_AMOUNT
    );
  }

  /** Points voided by a `starter-expiry:` journal (the SINK credit). */
  private voidedAmount(journal: LedgerJournalEntity): number {
    return journal.entries.find((entry) => entry.amount > 0)?.amount ?? 0;
  }

  /**
   * True while `journal` is recent enough for a lost notice to be recovered
   * (Epic 9 review P1/P7). Measured on the ledger clock, like the journal.
   */
  private isWithinRecoveryWindow(journal: LedgerJournalEntity): boolean {
    return (
      this.ledgerService.now().getTime() - journal.createdAt.getTime() <=
      NOTIFICATION_RECOVERY_WINDOW_MS
    );
  }

  /**
   * Starter points expiry notice (FR-57); deduplicated by the expiry journal
   * key, so the sweep and a later recovery never duplicate it.
   */
  private async publishExpired(
    userId: string,
    journal: LedgerJournalEntity,
  ): Promise<void> {
    await this.notificationPublisher?.publish({
      userId,
      type: 'WARNING',
      message: `Your ${this.voidedAmount(journal)} frozen starter points have expired because onboarding was not completed within ${STARTER_POINTS_EXPIRY_DAYS} days of registration.`,
      dedupeKey: journal.idempotencyKey,
    });
  }

  /** Account activation notice (FR-57); deduplicated by the unlock journal key. */
  private async publishActivated(
    userId: string,
    journal: LedgerJournalEntity,
  ): Promise<void> {
    const amount = this.creditedAmount(journal);
    await this.notificationPublisher?.publish({
      userId,
      type: 'ACCOUNT_ACTIVATED',
      message: `Congratulations! Your ${amount} starter points have been unlocked to your Available balance.`,
      dedupeKey: journal.idempotencyKey,
    });
  }
}
