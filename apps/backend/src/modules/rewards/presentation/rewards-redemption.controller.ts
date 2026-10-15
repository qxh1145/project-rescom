import { RewardsEnabledGuard } from './rewards-enabled.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  createRedemptionQuoteSchema,
  CreateRedemptionQuoteDto,
  redeemVoucherSchema,
  RedeemVoucherDto,
  idempotencyKeySchema,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { RewardsQuoteService } from '../application/rewards-quote.service';
import { RewardsRedemptionService } from '../application/rewards-redemption.service';

@Controller(['rewards', 'api/rewards'])
@UseGuards(RewardsEnabledGuard, SessionAuthGuard)
export class RewardsRedemptionController {
  constructor(
    private readonly quoteService: RewardsQuoteService,
    private readonly redemptionService: RewardsRedemptionService,
  ) {}

  // Per-user bounds (AppThrottlerGuard tracks the session user): quote rows are
  // cheap to spam and a Flash start is a thundering herd.
  @Post('quotes')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async createQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createRedemptionQuoteSchema))
    body: CreateRedemptionQuoteDto,
  ) {
    const quote = await this.quoteService.createQuote(user.id, body);
    return createSuccessEnvelope(quote);
  }

  @Post('redemptions')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async redeem(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKeyHeader: unknown,
    @Body(new ZodValidationPipe(redeemVoucherSchema))
    body: RedeemVoucherDto,
  ) {
    const parseResult = idempotencyKeySchema.safeParse(idempotencyKeyHeader);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          parseResult.error.errors[0]?.message ||
          'Invalid Idempotency-Key header',
        details: parseResult.error.format(),
      });
    }

    const result = await this.redemptionService.redeem(
      user.id,
      body,
      parseResult.data,
    );
    return createSuccessEnvelope(result);
  }

  // 201 for a replay, same as the FE mock and the contract table.
  @Get('redemptions/by-key/:key')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  async getByKey(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') rawKey: string,
  ) {
    const parseResult = idempotencyKeySchema.safeParse(rawKey);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          parseResult.error.errors[0]?.message || 'Invalid idempotency key',
        details: parseResult.error.format(),
      });
    }

    const result = await this.redemptionService.findByKey(
      user.id,
      parseResult.data,
    );
    return createSuccessEnvelope(result);
  }
}
