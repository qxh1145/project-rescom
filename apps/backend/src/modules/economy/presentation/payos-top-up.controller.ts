import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ParsedListPayosTopUpsQuery,
  PayosCheckoutInput,
  SubmitTopUpRefundInput,
  listPayosTopUpsQuerySchema,
  payosCheckoutSchema,
  submitTopUpRefundSchema,
  topUpRefundResultSchema,
} from '@rescom/schemas';

import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { PayosAvailability } from '../application/payos-availability';
import { PayosTopUpService } from '../application/payos-top-up.service';
import { TopUpRefundService } from '../application/top-up-refund.service';
import { PayosCheckoutEnabledGuard } from './payos-checkout-enabled.guard';

@Controller(['economy/top-ups/payos', 'api/economy/top-ups/payos'])
@UseGuards(SessionAuthGuard)
export class PayosTopUpController {
  constructor(
    private readonly service: PayosTopUpService,
    private readonly refundService: TopUpRefundService,
    private readonly availability: PayosAvailability,
  ) {}
  @Get('availability')
  availabilityStatus() {
    return createSuccessEnvelope({
      payosEnabled: this.availability.isCheckoutOpen(),
    });
  }
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PayosCheckoutEnabledGuard, CsrfGuard, JsonOnlyGuard)
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(payosCheckoutSchema)) body: PayosCheckoutInput,
  ) {
    return createSuccessEnvelope(await this.service.checkout(user.id, body));
  }
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listPayosTopUpsQuerySchema))
    query: ParsedListPayosTopUpsQuery,
  ) {
    return createSuccessEnvelope(await this.service.listOwned(user.id, query));
  }
  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return createSuccessEnvelope(await this.service.getOwned(user.id, id));
  }
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return createSuccessEnvelope(await this.service.cancel(user.id, id));
  }

  @Post(':id/refund-request')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async submitRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(submitTopUpRefundSchema))
    body: SubmitTopUpRefundInput,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const result = await this.refundService.submitRefund(id, body, {
      userId: user.id,
      correlationId,
    });
    return createSuccessEnvelope(topUpRefundResultSchema.parse(result));
  }

  @Post(':id/refund-request/withdraw')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async withdrawRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const result = await this.refundService.withdrawRefund(id, {
      userId: user.id,
      correlationId,
    });
    return createSuccessEnvelope(topUpRefundResultSchema.parse(result));
  }
}
