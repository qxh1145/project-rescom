import { CreateRedemptionQuoteDto, RedemptionQuoteDto } from '@rescom/schemas';
import { randomUUID } from 'crypto';
import { REWARDS_QUOTE_TTL_SECONDS } from './ports/rewards.constants';
import { VoucherRepositoryPort } from './ports/voucher-repository.port';
import { FlashSaleReadPort } from './ports/flash-sale-read.port';
import { WalletBalancePort } from './ports/wallet-balance.port';
import {
  RedemptionRepositoryPort,
  RedemptionQuoteRecord,
} from './ports/redemption-repository.port';
import { AccountStandingPort } from './ports/account-standing.port';
import {
  RewardsException,
  RedemptionRejectionException,
} from './exceptions/rewards.exceptions';
import { effectivePrice } from '../domain/voucher-price';
import { effectiveStatus } from '../domain/voucher-availability';
import { checkAccountEligibility } from '../domain/redemption-eligibility';
import {
  checkRedemptionLimits,
  getVietnamCalendarDayRange,
} from '../domain/redemption-limits';

export interface RewardsQuoteServiceDependencies {
  vouchers: VoucherRepositoryPort;
  flashSales: FlashSaleReadPort;
  redemptions: RedemptionRepositoryPort;
  wallet: WalletBalancePort;
  accountStanding: AccountStandingPort;
  now: () => Date;
}

export class RewardsQuoteService {
  private readonly now: () => Date;

  constructor(private readonly deps: RewardsQuoteServiceDependencies) {
    this.now = deps.now;
  }

  async createQuote(
    userId: string,
    dto: CreateRedemptionQuoteDto,
  ): Promise<RedemptionQuoteDto> {
    const currentTime = this.now();
    const nowMs = currentTime.getTime();

    const voucher = await this.deps.vouchers.findById(dto.voucherId);
    if (!voucher || voucher.state === 'ARCHIVED' || !voucher.isVisible) {
      throw new RewardsException('VOUCHER_NOT_FOUND', 'Voucher not found');
    }

    const activeFlash = await this.deps.flashSales.findActiveItemForVoucher(
      voucher.id,
      currentTime,
    );

    const hasActiveFlash =
      activeFlash !== null && activeFlash.sold < activeFlash.quota;
    const status = effectiveStatus(voucher, nowMs, hasActiveFlash);

    if (status !== 'AVAILABLE') {
      if (status === 'SOLD_OUT') {
        throw new RedemptionRejectionException(
          'SOLD_OUT',
          'Voucher is sold out',
          {
            voucherId: voucher.id,
            regularStockRemaining: voucher.stockRemaining,
          },
        );
      }
      throw new RedemptionRejectionException(
        'VOUCHER_UNAVAILABLE',
        'Voucher is unavailable',
        {
          voucherId: voucher.id,
          status: status === 'HIDDEN' ? 'HIDDEN' : status,
        },
      );
    }

    const price = effectivePrice(voucher, activeFlash);
    // Flash rules, the Flash cap and the Flash end only apply when the quoted
    // price actually is the Flash price (a sold-out Flash falls back to promo/base).
    const flash = price.source === 'FLASH' ? activeFlash : null;

    // Account eligibility check
    const isActive = await this.deps.accountStanding.isActive(userId);
    const isActivated = await this.deps.accountStanding.isActivated(userId);
    const thirtyDaysAgo = new Date(nowMs - 30 * 86_400_000);
    const hasRecentCompletedSurvey =
      await this.deps.accountStanding.completedSurveyInLastDays(
        userId,
        30,
        currentTime,
      );
    const hasBlockingFraudFlag =
      await this.deps.accountStanding.hasBlockingFraudFlag(
        userId,
        thirtyDaysAgo,
      );

    const eligibilityIneligibility = checkAccountEligibility(
      {
        isActive,
        isActivated,
        hasRecentCompletedSurvey,
        hasBlockingFraudFlag,
      },
      flash?.flashSale.rules,
    );

    if (eligibilityIneligibility) {
      throw new RedemptionRejectionException(
        'ACCOUNT_NOT_ELIGIBLE',
        'Account is not eligible to redeem this voucher',
        { reason: eligibilityIneligibility },
      );
    }

    // Advisory limit check
    const perVoucher30dCount =
      await this.deps.redemptions.countVoucherRedemptionsInWindow(
        userId,
        voucher.id,
        thirtyDaysAgo,
      );
    const dayRange = getVietnamCalendarDayRange(currentTime);
    const todayPoints = await this.deps.redemptions.countTodayRedeemedPoints(
      userId,
      dayRange.start,
      dayRange.end,
    );
    const flashUserCount = flash
      ? await this.deps.redemptions.countFlashItemRedemptionsForUser(
          userId,
          flash.id,
        )
      : undefined;

    const dailyPointsLimit = await this.deps.redemptions.getDailyPointsLimit();
    const limitError = checkRedemptionLimits(
      { perVoucher30dCount, todayPoints, flashUserCount },
      price.points,
      dailyPointsLimit,
      flash,
    );

    if (limitError) {
      throw new RedemptionRejectionException(
        'ACCOUNT_NOT_ELIGIBLE',
        'Redemption limit reached',
        { reason: limitError },
      );
    }

    // Balance check
    const balance = await this.deps.wallet.getBalance(userId);
    if (balance.available < price.points) {
      throw new RedemptionRejectionException(
        'INSUFFICIENT_POINTS',
        'Insufficient points balance',
        { required: price.points, available: balance.available },
      );
    }

    // Calculate expiry: min(now + TTL, flashEndsAt)
    const quoteTtlExpiry = new Date(nowMs + REWARDS_QUOTE_TTL_SECONDS * 1000);
    let expiresAt = quoteTtlExpiry;
    let flashEndsAt: string | null = null;

    if (flash) {
      const flashEnd = new Date(flash.flashSale.endsAt);
      flashEndsAt = flashEnd.toISOString();
      if (flashEnd.getTime() < expiresAt.getTime()) {
        expiresAt = flashEnd;
      }
    }

    const quoteId = randomUUID();
    const record: RedemptionQuoteRecord = {
      id: quoteId,
      userId,
      voucherId: voucher.id,
      flashSaleItemId: flash ? flash.id : null,
      priceVersion: price.priceVersion,
      pricePoints: price.points,
      priceSource: price.source,
      expiresAt: expiresAt.toISOString(),
      createdAt: currentTime.toISOString(),
    };

    await this.deps.redemptions.insertQuote(record);

    return {
      quoteId,
      voucherId: voucher.id,
      price,
      flashSaleItemId: flash ? flash.id : null,
      expiresAt: expiresAt.toISOString(),
      flashEndsAt,
      balance: {
        available: balance.available,
        after: balance.available - price.points,
      },
      serverTime: currentTime.toISOString(),
    };
  }
}
