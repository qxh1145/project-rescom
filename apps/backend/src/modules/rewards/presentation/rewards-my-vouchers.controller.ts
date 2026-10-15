import { RewardsEnabledGuard } from './rewards-enabled.guard';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  createCodeIssueReportSchema,
  CreateCodeIssueReportDto,
  redemptionHistoryQuerySchema,
  RedemptionHistoryQuery,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { RewardsMyVouchersService } from '../application/rewards-my-vouchers.service';

@Controller(['rewards', 'api/rewards'])
@UseGuards(RewardsEnabledGuard, SessionAuthGuard)
export class RewardsMyVouchersController {
  constructor(private readonly service: RewardsMyVouchersService) {}

  @Get('my-vouchers')
  @Header('Cache-Control', 'no-store')
  async listTickets(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.service.listTickets(user.id);
    return createSuccessEnvelope(result);
  }

  @Get('my-vouchers/:id')
  @Header('Cache-Control', 'no-store')
  async getTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.service.getTicket(user.id, id);
    return createSuccessEnvelope(result);
  }

  @Post('my-vouchers/:id/use')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(CsrfGuard)
  async markUsed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.service.markUsed(user.id, id);
    return createSuccessEnvelope(result);
  }

  @Post('my-vouchers/:id/undo-use')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(CsrfGuard)
  async undoUse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.service.undoUse(user.id, id);
    return createSuccessEnvelope(result);
  }

  @Post('my-vouchers/:id/issues')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async reportCodeIssue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createCodeIssueReportSchema))
    body: CreateCodeIssueReportDto,
  ) {
    const result = await this.service.reportCodeIssue(user.id, id, body);
    return createSuccessEnvelope(result);
  }

  @Get('redemptions')
  @Header('Cache-Control', 'no-store')
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Query(
      new ZodValidationPipe(
        redemptionHistoryQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: RedemptionHistoryQuery,
  ) {
    const result = await this.service.history(user.id, query);
    return createSuccessEnvelope(result);
  }
}
