import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PayosCheckoutInput, payosCheckoutSchema } from '@rescom/schemas';
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
import { PayosCheckoutEnabledGuard } from './payos-checkout-enabled.guard';

@Controller(['economy/top-ups/payos', 'api/economy/top-ups/payos'])
@UseGuards(SessionAuthGuard)
export class PayosTopUpController {
  constructor(
    private readonly service: PayosTopUpService,
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
}
