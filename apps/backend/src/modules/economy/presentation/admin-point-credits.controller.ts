import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  AdminPointCreditDto,
  AdminPointCreditList,
  CreateAdminPointCreditDto,
  createAdminPointCreditSchema,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser, Roles } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { AdminPointCreditService } from '../application/admin-point-credit.service';
import { LedgerService } from '../application/ledger.service';

import { createSuccessEnvelope } from '../../../common/http/response.envelope';

/**
 * Story 14.5: Admin Direct Point Credit endpoints (FR-80, FR-ADD-11).
 */
@Controller(['admin/users', 'api/admin/users'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminPointCreditsController {
  constructor(
    private readonly adminPointCreditService: AdminPointCreditService,
    private readonly ledgerService: LedgerService,
  ) {}

  @Post(':id/point-credits')
  @HttpCode(200)
  @UseGuards(JsonOnlyGuard, CsrfGuard)
  @UsePipes(
    new ZodValidationPipe(
      createAdminPointCreditSchema,
      'VALIDATION_ERROR',
      'body',
    ),
  )
  async creditPoints(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateAdminPointCreditDto,
  ) {
    const result = await this.adminPointCreditService.credit(
      actor.id,
      id,
      body,
    );
    return createSuccessEnvelope(result);
  }

  @Get(':id/point-credits')
  async listCredits(@Param('id', ParseUUIDPipe) id: string) {
    const credits = await this.ledgerService.listAdminCredits(id, 50);
    return createSuccessEnvelope({
      items: credits.map((c) => ({
        journalId: c.journalId,
        amount: c.amount,
        reason: c.reason,
        createdAt: c.createdAt.toISOString(),
        reversed: c.reversed,
        reversalJournalId: c.reversalJournalId,
        reversedAt: c.reversedAt ? c.reversedAt.toISOString() : null,
      })),
    });
  }
}
