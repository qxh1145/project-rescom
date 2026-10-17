import {
  Body,
  Controller,
  Get,
  Header,
  Res,
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
  ListAdminPayosTopUpsQuery,
  ExportAdminPayosTopUps,
  listAdminPayosTopUpsQuerySchema,
  exportAdminPayosTopUpsSchema,
  RejectTopUpRequestInput,
  listTopUpRequestsQuerySchema,
  rejectTopUpRequestSchema,
  ResolveTopUpMismatch,
  resolveTopUpMismatchSchema,
  adminTopUpActionRequiredSchema,
  AdminTopUpRefundListQuery,
  adminTopUpRefundListQuerySchema,
  ResolveTopUpRefund,
  resolveTopUpRefundSchema,
  RecordTopUpRefundBankTransfer,
  recordTopUpRefundBankTransferSchema,
} from '@rescom/schemas';
import { Response } from 'express';
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
import { PayosTopUpService } from '../application/payos-top-up.service';
import { AdminTopUpRefundService } from '../application/admin-top-up-refund.service';

/**
 * Admin review queue for manual top-ups (Story 6.6, FR-35). `RolesGuard`
 * checks the session role; the service re-verifies the live Admin capability
 * inside the financial transaction (AD-16).
 */
@Controller(['admin/top-ups', 'api/admin/top-ups'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminTopUpController {
  constructor(
    private readonly topUpService: TopUpService,
    private readonly payosTopUpService: PayosTopUpService,
    private readonly adminRefundService: AdminTopUpRefundService,
  ) {}

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

  @Get('payos')
  @Header('Cache-Control', 'no-store')
  async listPayos(
    @Query(
      new ZodValidationPipe(
        listAdminPayosTopUpsQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListAdminPayosTopUpsQuery,
  ) {
    return createSuccessEnvelope(
      await this.payosTopUpService.listForAdmin(query),
    );
  }

  @Get('action-required')
  @Header('Cache-Control', 'no-store')
  async actionRequired() {
    return createSuccessEnvelope(
      adminTopUpActionRequiredSchema.parse(
        await this.payosTopUpService.listActionRequired(),
      ),
    );
  }

  @Get('tab-counts')
  @Header('Cache-Control', 'no-store')
  async tabCounts() {
    return createSuccessEnvelope(await this.payosTopUpService.tabCounts());
  }

  @Get('refunds')
  @Header('Cache-Control', 'no-store')
  async listRefunds(
    @Query(
      new ZodValidationPipe(
        adminTopUpRefundListQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: AdminTopUpRefundListQuery,
  ) {
    return createSuccessEnvelope(await this.adminRefundService.list(query));
  }

  @Get('refunds/:requestId')
  @Header('Cache-Control', 'no-store')
  async getRefund(@Param('requestId', ParseUUIDPipe) requestId: string) {
    return createSuccessEnvelope(await this.adminRefundService.get(requestId));
  }

  @Post('refunds/:requestId/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async resolveRefund(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(
      new ZodValidationPipe(
        resolveTopUpRefundSchema,
        'VALIDATION_ERROR',
        'body',
      ),
    )
    body: ResolveTopUpRefund,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.adminRefundService.resolve(requestId, body, {
        adminId: admin.id,
        correlationId,
      }),
    );
  }

  @Post('refunds/:requestId/bank-transfer')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async recordBankTransfer(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(
      new ZodValidationPipe(
        recordTopUpRefundBankTransferSchema,
        'VALIDATION_ERROR',
        'body',
      ),
    )
    body: RecordTopUpRefundBankTransfer,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.adminRefundService.recordBankTransfer(requestId, body, {
        adminId: admin.id,
        correlationId,
      }),
    );
  }

  @Post('payos/export')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async exportPayos(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(
      new ZodValidationPipe(
        exportAdminPayosTopUpsSchema,
        'VALIDATION_ERROR',
        'body',
      ),
    )
    body: ExportAdminPayosTopUps,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.payosTopUpService.exportForAdmin({
      ...body,
      adminId: admin.id,
      correlationId,
    });
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="rescom-payos-topups-${body.from}-${body.to}.csv"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    return csv;
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

  @Post(':id/resolve-mismatch')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async resolveMismatch(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodValidationPipe(
        resolveTopUpMismatchSchema,
        'VALIDATION_ERROR',
        'body',
      ),
    )
    body: ResolveTopUpMismatch,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.payosTopUpService.resolveMismatch(id, body, {
        adminId: admin.id,
        correlationId,
      }),
    );
  }

  @Post(':id/recheck')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async recheck(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const result = await this.payosTopUpService.recheck({
      topUpId: id,
      adminId: admin.id,
      correlationId,
    });
    return createSuccessEnvelope(result);
  }
}
