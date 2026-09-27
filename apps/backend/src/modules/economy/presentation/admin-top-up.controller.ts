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
  ListTopUpRequestsQuery,
  RejectTopUpRequestInput,
  listTopUpRequestsQuerySchema,
  rejectTopUpRequestSchema,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser, Roles } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { TopUpService } from '../application/top-up.service';

/**
 * Admin review queue for manual top-ups (Story 6.6, FR-35). `RolesGuard`
 * checks the session role; the service re-verifies the live Admin capability
 * inside the financial transaction (AD-16).
 */
@Controller(['admin/top-ups', 'api/admin/top-ups'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminTopUpController {
  constructor(private readonly topUpService: TopUpService) {}

  /** Pending requests by default (oldest first) with user info and amount. */
  @Get()
  async list(
    @Query(
      new ZodValidationPipe(
        listTopUpRequestsQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListTopUpRequestsQuery,
  ) {
    const result = await this.topUpService.listForReview(query);
    return createSuccessEnvelope(result);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const result = await this.topUpService.approveTopUp({
      topUpId: id,
      adminId: admin.id,
      correlationId,
    });
    return createSuccessEnvelope(result);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rejectTopUpRequestSchema))
    body: RejectTopUpRequestInput,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const result = await this.topUpService.rejectTopUp({
      topUpId: id,
      adminId: admin.id,
      reason: body.reason,
      correlationId,
    });
    return createSuccessEnvelope(result);
  }
}
