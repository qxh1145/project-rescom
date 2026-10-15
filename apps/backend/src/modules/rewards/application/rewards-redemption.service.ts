import { RedeemVoucherDto, RedemptionResultDto } from '@rescom/schemas';
import { randomUUID } from 'crypto';
import { UnitOfWorkPort } from '../../../common/database/unit-of-work.port';
import { VoucherRepositoryPort } from './ports/voucher-repository.port';
import { FlashSaleReadPort } from './ports/flash-sale-read.port';
import {
  RedemptionRepositoryPort,
  RedemptionRecord,
  RedemptionQuoteRecord,
} from './ports/redemption-repository.port';
import { WalletBalancePort } from './ports/wallet-balance.port';
import { AccountStandingPort } from './ports/account-standing.port';
import { SpendPointsPort } from './ports/spend-points.port';
import { FraudFlagPort } from './ports/fraud-flag.port';
import {
  RewardsException,
  RedemptionRejectionException,
  QuoteNotFoundException,
  QuoteAlreadyRedeemedException,
  IdempotencyKeyConflictException,
  RedemptionNotFoundException,
  ReplayedRedemptionRejectionException,
} from './exceptions/rewards.exceptions';
import { decideRedemption } from '../domain/redemption-decision';
import { checkAccountEligibility } from '../domain/redemption-eligibility';
import {
  checkRedemptionLimits,
  getVietnamCalendarDayRange,
} from '../domain/redemption-limits';
import { generateRedemptionReference } from '../domain/redemption-reference';
import { toVoucherTicket } from '../domain/voucher-ticket';
import { REWARDS_FLASH_AFTER_TOPUP_HOURS } from './ports/rewards.constants';
import { uniqueViolationOf } from './unique-violation';

const MAX_REFERENCE_ATTEMPTS = 3;

export interface RewardsRedemptionServiceDependencies {
  vouchers: VoucherRepositoryPort;
  flashSales: FlashSaleReadPort;
  redemptions: RedemptionRepositoryPort;
  wallet: WalletBalancePort;
  accountStanding: AccountStandingPort;
  spendPoints: SpendPointsPort;
  fraudFlag: FraudFlagPort;
  unitOfWork: UnitOfWorkPort;
  now: () => Date;
}

export class RewardsRedemptionService {
  private readonly now: () => Date;

  constructor(private readonly deps: RewardsRedemptionServiceDependencies) {
    this.now = deps.now;
  }

  async redeem(
    userId: string,
    dto: RedeemVoucherDto,
    idempotencyKey: string,
  ): Promise<RedemptionResultDto> {
    // Step 0: outside tx fast path
    const existingFast = await this.deps.redemptions.findRedemptionByUserAndKey(
      userId,
      idempotencyKey,
    );
    if (existingFast) {
      if (existingFast.quoteId !== dto.quoteId) {
        throw new IdempotencyKeyConflictException(idempotencyKey);
      }
      return this.replayExisting(existingFast);
    }

    // Step 1: Load quote by id; missing or not owned -> 404
    const quote = await this.deps.redemptions.findQuoteById(dto.quoteId);
    if (!quote || quote.userId !== userId) {
      throw new QuoteNotFoundException(dto.quoteId);
    }

    try {
      return await this.runRedemption(userId, dto, idempotencyKey, quote);
    } catch (error) {
      // Step 3: Atomic failure handling
      if (error instanceof ReplayedRedemptionRejectionException) throw error;
      if (!(
        error instanceof RedemptionRejectionException ||
        error instanceof InventoryDriftException ||
        (error instanceof Error &&
          error.name === 'InsufficientBalanceException')
      )) {
        throw error;
      }

      let failureCode: RedemptionRejectionException['code'];
      let failureDetails: Record<string, unknown>;

      if (error instanceof InventoryDriftException) {
        failureCode = 'SOLD_OUT';
        const v = await this.deps.vouchers.findById(quote.voucherId);
        failureDetails = {
          voucherId: quote.voucherId,
          regularStockRemaining: v?.stockRemaining ?? 0,
        };
      } else if (error instanceof RedemptionRejectionException) {
        failureCode = error.code;
        failureDetails = error.details;
      } else {
        failureCode = 'INSUFFICIENT_POINTS';
        const freshBalance = await this.deps.wallet.getBalance(userId);
        failureDetails = {
          required: quote.pricePoints,
          available: freshBalance.available,
        };
      }

      // Record failed attempt in a separate transaction
      const concurrent = await this.recordFailure(
        userId,
        quote,
        idempotencyKey,
        failureCode,
        failureDetails,
        error instanceof InventoryDriftException ? quote.voucherId : undefined,
      );
      // A concurrent same-key attempt recorded its outcome first: replay it.
      if (concurrent) {
        if (concurrent.quoteId !== dto.quoteId) {
          throw new IdempotencyKeyConflictException(idempotencyKey);
        }
        return this.replayExisting(concurrent);
      }

      throw new RedemptionRejectionException(
        failureCode,
        'Redemption failed',
        failureDetails,
      );
    }
  }

  async findByKey(userId: string, key: string): Promise<RedemptionResultDto> {
    const existing = await this.deps.redemptions.findRedemptionByUserAndKey(
      userId,
      key,
    );
    if (!existing) {
      throw new RedemptionNotFoundException(key);
    }
    return this.replayExisting(existing);
  }

  /**
   * One redeem transaction, re-run only when the generated reference collides
   * (`reference` is UNIQUE and PG aborts the whole transaction on a violation,
   * so the retry restarts the unit of work). Other unique violations mean a
   * concurrent winner exists: converge on its stored outcome.
   */
  private async runRedemption(
    userId: string,
    dto: RedeemVoucherDto,
    idempotencyKey: string,
    quote: RedemptionQuoteRecord,
  ): Promise<RedemptionResultDto> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.redeemOnce(userId, idempotencyKey, quote);
      } catch (error) {
        const violation = uniqueViolationOf(error);
        if (violation === 'reference' && attempt < MAX_REFERENCE_ATTEMPTS) {
          continue;
        }
        if (violation === 'idempotency') {
          const winner = await this.deps.redemptions.findRedemptionByUserAndKey(
            userId,
            idempotencyKey,
          );
          if (winner) {
            if (winner.quoteId !== dto.quoteId) {
              throw new IdempotencyKeyConflictException(idempotencyKey);
            }
            return this.replayExisting(winner);
          }
        }
        if (violation === 'quote') {
          throw new QuoteAlreadyRedeemedException(quote.id);
        }
        throw error;
      }
    }
  }

  private redeemOnce(
    userId: string,
    idempotencyKey: string,
    quote: RedemptionQuoteRecord,
  ): Promise<RedemptionResultDto> {
    return this.deps.unitOfWork.run(
      `redemption:${userId}:${idempotencyKey}`,
      async () => {
        // 2.a: Lock Voucher row first
        await this.deps.vouchers.lock(quote.voucherId);

        // Decide every time-based rule (price window, 30-day and VN-day
        // limits, quote expiry) after the lock wait, not before it.
        const currentTime = this.now();
        const nowMs = currentTime.getTime();

        // 2.b: Re-run idempotency lookup under lock
        const existingLocked =
          await this.deps.redemptions.findRedemptionByUserAndKey(
            userId,
            idempotencyKey,
          );
        if (existingLocked) {
          if (existingLocked.quoteId !== quote.id) {
            throw new IdempotencyKeyConflictException(idempotencyKey);
          }
          return this.replayExisting(existingLocked);
        }

        // 2.c: Quote already has a SUCCEEDED redemption -> 409
        const existingSucceededQuote =
          await this.deps.redemptions.findSucceededRedemptionByQuoteId(
            quote.id,
          );
        if (existingSucceededQuote) {
          throw new QuoteAlreadyRedeemedException(quote.id);
        }

        // Load fresh voucher
        const voucher = await this.deps.vouchers.findById(quote.voucherId);
        if (!voucher) {
          throw new RewardsException('VOUCHER_NOT_FOUND', 'Voucher not found');
        }

        // 2.d: Read active Flash item; if used -> lock FlashSaleItem row
        let activeFlash = await this.deps.flashSales.findActiveItemForVoucher(
          voucher.id,
          currentTime,
        );
        const flashItemIdToLock = quote.flashSaleItemId ?? activeFlash?.id;
        if (flashItemIdToLock) {
          await this.deps.flashSales.lockFlashItem(flashItemIdToLock);
          // Re-read under the lock so `sold` is not stale.
          activeFlash = await this.deps.flashSales.findActiveItemForVoucher(
            voucher.id,
            currentTime,
          );
        }

        // 2.e: Pure decision (stock & price checks)
        // Note: code availability is checked under lock at 2.h to distinguish
        // normal SOLD_OUT from inventory drift. A Flash reservation moves the
        // quota out of stock_remaining, so a quota equal to the whole stock
        // leaves it at 0 while codes remain: take the larger of the two.
        const decisionRejection = decideRedemption(
          {
            ...voucher,
            codesAvailable: Math.max(
              voucher.codesAvailable,
              voucher.stockRemaining,
            ),
          },
          activeFlash
            ? {
                id: activeFlash.id,
                flashPoints: activeFlash.flashPoints,
                quota: activeFlash.quota,
                sold: activeFlash.sold,
              }
            : null,
          {
            pricePoints: quote.pricePoints,
            priceSource: quote.priceSource,
            priceVersion: quote.priceVersion,
            flashSaleItemId: quote.flashSaleItemId,
            expiresAt: quote.expiresAt,
          },
          nowMs,
        );
        if (decisionRejection) {
          throw new RedemptionRejectionException(
            decisionRejection.code,
            'Redemption rejected',
            decisionRejection.details,
          );
        }

        // The decision passed, so the effective price source equals the
        // quote's. Flash rules and the Flash cap only apply to a Flash purchase.
        const flash = quote.priceSource === 'FLASH' ? activeFlash : null;

        // 2.f: Eligibility again inside transaction
        const thirtyDaysAgo = new Date(nowMs - 30 * 86_400_000);
        const eligibilityReason = checkAccountEligibility(
          {
            isActive: await this.deps.accountStanding.isActive(userId),
            isActivated: await this.deps.accountStanding.isActivated(userId),
            hasRecentCompletedSurvey:
              await this.deps.accountStanding.completedSurveyInLastDays(
                userId,
                30,
                currentTime,
              ),
            hasBlockingFraudFlag:
              await this.deps.accountStanding.hasBlockingFraudFlag(
                userId,
                thirtyDaysAgo,
              ),
          },
          flash?.flashSale.rules,
        );
        if (eligibilityReason) {
          throw new RedemptionRejectionException(
            'ACCOUNT_NOT_ELIGIBLE',
            'Account is not eligible to redeem this voucher',
            { reason: eligibilityReason },
          );
        }

        // 2.g: Conditional stock decrement. A FLASH purchase only increments
        // flash_sale_items.sold (quota left stock_remaining at reservation).
        // A BASE/PROMO purchase decrements stock_remaining.
        const soldOut = (reason: string, remaining: number) =>
          new RedemptionRejectionException('SOLD_OUT', reason, {
            voucherId: voucher.id,
            regularStockRemaining: remaining,
          });
        if (flash) {
          const incremented = await this.deps.flashSales.incrementFlashSold(
            flash.id,
            currentTime,
          );
          if (!incremented) {
            throw soldOut('Flash quota exhausted', voucher.stockRemaining);
          }
        } else {
          const decremented = await this.deps.vouchers.decrementRegularStock(
            voucher.id,
            voucher.updatedAt,
          );
          if (!decremented) {
            throw soldOut('Voucher stock exhausted', 0);
          }
        }

        // 2.h: Claim code
        const redemptionId = randomUUID();
        let claimedCode: string;
        let voucherCodeId: string | null = null;

        if (voucher.isSharedCode) {
          if (!voucher.sharedCode) {
            throw soldOut('Shared code not configured', voucher.stockRemaining);
          }
          claimedCode = voucher.sharedCode;
        } else {
          const claimed = await this.deps.redemptions.claimCode(voucher.id);
          if (!claimed) {
            // Stock > 0 but no free code: drift alert needed
            throw new InventoryDriftException(voucher.id);
          }
          claimedCode = claimed.code;
          voucherCodeId = claimed.id;
        }

        // 2.i: SpendPoints with assertBeforeInsert limits check. The ledger key
        // carries the user id so it can only collide with this user's own key.
        let journalSpend;
        try {
          journalSpend = await this.deps.spendPoints.spendPoints(
            {
              userId,
              amount: quote.pricePoints,
              idempotencyKey: `redemption:${userId}:${idempotencyKey}`,
              description: `Voucher redemption: ${voucher.title} (${quote.pricePoints} pts)`,
            },
            {
              assertBeforeInsert: async () => {
                const dayRange = getVietnamCalendarDayRange(currentTime);
                const limitErr = checkRedemptionLimits(
                  {
                    perVoucher30dCount:
                      await this.deps.redemptions.countVoucherRedemptionsInWindow(
                        userId,
                        voucher.id,
                        thirtyDaysAgo,
                      ),
                    todayPoints:
                      await this.deps.redemptions.countTodayRedeemedPoints(
                        userId,
                        dayRange.start,
                        dayRange.end,
                      ),
                    flashUserCount: flash
                      ? await this.deps.redemptions.countFlashItemRedemptionsForUser(
                          userId,
                          flash.id,
                        )
                      : undefined,
                  },
                  quote.pricePoints,
                  await this.deps.redemptions.getDailyPointsLimit(),
                  flash,
                );
                if (limitErr) {
                  throw new RedemptionRejectionException(
                    'ACCOUNT_NOT_ELIGIBLE',
                    'Redemption limit exceeded',
                    { reason: limitErr },
                  );
                }
              },
            },
          );
        } catch (error) {
          if (
            error instanceof Error &&
            error.name === 'IdempotencyConflictException'
          ) {
            throw new IdempotencyKeyConflictException(idempotencyKey);
          }
          throw error;
        }

        const balanceAfter = (await this.deps.wallet.getBalance(userId))
          .available;
        const reference = generateRedemptionReference(
          currentTime.getUTCFullYear(),
        );

        // 2.j: Insert Redemption SUCCEEDED
        await this.deps.redemptions.insertRedemption({
          id: redemptionId,
          userId,
          voucherId: voucher.id,
          voucherCodeId,
          flashSaleItemId: flash ? flash.id : null,
          quoteId: quote.id,
          idempotencyKey,
          status: 'SUCCEEDED',
          pricePoints: quote.pricePoints,
          priceSource: quote.priceSource,
          priceVersion: quote.priceVersion,
          journalId: journalSpend.journalId,
          balanceAfter,
          failureCode: null,
          failureDetails: null,
          reference,
          createdAt: currentTime.toISOString(),
        });

        // 2.j-claim: DB backstop for BR-19 when perUserCap = 1
        if (flash && flash.perUserCap === 1) {
          await this.deps.redemptions.claimFlashItem(
            flash.id,
            userId,
            redemptionId,
          );
        }

        // Link code to redemption after redemption record is inserted
        if (voucherCodeId) {
          await this.deps.redemptions.linkCodeToRedemption(
            voucherCodeId,
            redemptionId,
          );
        }

        // 2.l: Append Outbox event REWARDS_VOUCHER_REDEEMED
        await this.deps.vouchers.appendAudit({
          id: randomUUID(),
          idempotencyKey: `redemption:outbox:${redemptionId}`,
          eventType: 'REWARDS_VOUCHER_REDEEMED',
          producer: 'rewards-redemption',
          aggregateType: 'Redemption',
          aggregateId: redemptionId,
          aggregateVersion: 1,
          correlationId: redemptionId,
          payload: {
            redemptionId,
            userId,
            voucherId: voucher.id,
            pricePoints: quote.pricePoints,
            priceSource: quote.priceSource,
            reference,
          },
        });

        // 2.k: Flash after top-up (<24h, source FLASH). Last step: the FraudLog
        // writer is Participation's `recordFraudLog`, which survives rollback,
        // so nothing after it may still fail the redemption.
        if (flash) {
          const hasRecentTopUp =
            await this.deps.accountStanding.hasApprovedTopUpSince(
              userId,
              new Date(nowMs - REWARDS_FLASH_AFTER_TOPUP_HOURS * 3600 * 1000),
            );
          if (hasRecentTopUp) {
            await this.deps.fraudFlag.recordFlashAfterTopUp({
              userId,
              redemptionId,
              voucherId: voucher.id,
              now: currentTime,
            });
          }
        }

        return {
          redemptionId,
          reference,
          status: 'SUCCEEDED' as const,
          voucherId: voucher.id,
          pointsSpent: quote.pricePoints,
          priceSource: quote.priceSource,
          balanceAfter,
          ticket: toVoucherTicket(
            {
              id: redemptionId,
              reference,
              pricePoints: quote.pricePoints,
              priceSource: quote.priceSource,
              createdAt: currentTime,
            },
            voucher,
            claimedCode,
            nowMs,
          ),
          createdAt: currentTime.toISOString(),
        };
      },
    );
  }

  private async replayExisting(
    record: RedemptionRecord,
  ): Promise<RedemptionResultDto> {
    if (record.status === 'FAILED') {
      throw new ReplayedRedemptionRejectionException(
        record.failureCode as RedemptionRejectionException['code'],
        record.failureDetails ?? {},
      );
    }
    if (record.status !== 'SUCCEEDED') {
      // A refund row never answers a purchase; the key belongs to another operation.
      throw new IdempotencyKeyConflictException(record.idempotencyKey);
    }

    const voucher = await this.deps.vouchers.findById(record.voucherId);
    if (!voucher) {
      throw new RewardsException('VOUCHER_NOT_FOUND', 'Voucher not found');
    }

    let claimedCode: string | null | undefined;
    if (voucher.isSharedCode) {
      claimedCode = voucher.sharedCode;
    } else if (record.voucherCodeId) {
      claimedCode = (
        await this.deps.redemptions.findCodeById(record.voucherCodeId)
      )?.code;
    }
    if (!claimedCode || record.balanceAfter === null) {
      throw new Error(
        `Redemption ${record.id} is missing its voucher code or balance snapshot`,
      );
    }

    return {
      redemptionId: record.id,
      reference: record.reference,
      status: 'SUCCEEDED',
      voucherId: record.voucherId,
      pointsSpent: record.pricePoints,
      priceSource: record.priceSource,
      balanceAfter: record.balanceAfter,
      ticket: toVoucherTicket(
        {
          id: record.id,
          reference: record.reference,
          pricePoints: record.pricePoints,
          priceSource: record.priceSource,
          createdAt: record.createdAt,
        },
        voucher,
        claimedCode,
        this.now().getTime(),
      ),
      createdAt: new Date(record.createdAt).toISOString(),
    };
  }

  /**
   * Records the failed attempt (no journal) in its own transaction. Returns the
   * row a concurrent same-key attempt committed first, if any, so the caller
   * can replay it. The drift alert runs in a separate transaction so its
   * hourly-deduped key can never roll the FAILED row back.
   */
  private async recordFailure(
    userId: string,
    quote: RedemptionQuoteRecord,
    idempotencyKey: string,
    failureCode: string,
    failureDetails: Record<string, unknown>,
    driftVoucherId?: string,
  ): Promise<RedemptionRecord | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.deps.unitOfWork.run(
          `redemption-failure:${userId}:${idempotencyKey}`,
          async () => {
            const currentTime = this.now();
            await this.deps.redemptions.insertRedemption({
              id: randomUUID(),
              userId,
              voucherId: quote.voucherId,
              voucherCodeId: null,
              flashSaleItemId: quote.flashSaleItemId,
              quoteId: quote.id,
              idempotencyKey,
              status: 'FAILED',
              pricePoints: quote.pricePoints,
              priceSource: quote.priceSource,
              priceVersion: quote.priceVersion,
              journalId: null,
              balanceAfter: null,
              failureCode,
              failureDetails,
              reference: generateRedemptionReference(
                currentTime.getUTCFullYear(),
              ),
              createdAt: currentTime.toISOString(),
            });
          },
        );
        break;
      } catch (error) {
        const violation = uniqueViolationOf(error);
        if (violation === 'reference' && attempt < MAX_REFERENCE_ATTEMPTS) {
          continue;
        }
        if (violation === 'idempotency') {
          const winner = await this.deps.redemptions.findRedemptionByUserAndKey(
            userId,
            idempotencyKey,
          );
          if (winner) return winner;
        }
        throw error;
      }
    }

    if (driftVoucherId) {
      await this.alertInventoryDrift(driftVoucherId, quote.id);
    }
    return null;
  }

  private async alertInventoryDrift(
    voucherId: string,
    correlationId: string,
  ): Promise<void> {
    const hourStamp = this.now().toISOString().slice(0, 13);
    try {
      await this.deps.unitOfWork.run(
        `redemption-drift:${voucherId}:${hourStamp}`,
        () =>
          this.deps.vouchers.appendAudit({
            id: randomUUID(),
            idempotencyKey: `rewards:inventory-drift:${voucherId}:${hourStamp}`,
            eventType: 'REWARDS_CODE_INVENTORY_DRIFT',
            producer: 'rewards-redemption',
            aggregateType: 'Voucher',
            aggregateId: voucherId,
            aggregateVersion: 1,
            correlationId,
            payload: { voucherId, schemaVersion: 1 },
          }),
      );
    } catch (error) {
      // The hourly key already exists: this hour was alerted. Anything else is real.
      if (uniqueViolationOf(error) === null) throw error;
    }
  }
}

class InventoryDriftException extends Error {
  constructor(readonly voucherId: string) {
    super(`Stock > 0 but no available voucher code for voucher ${voucherId}`);
    this.name = 'InventoryDriftException';
  }
}
