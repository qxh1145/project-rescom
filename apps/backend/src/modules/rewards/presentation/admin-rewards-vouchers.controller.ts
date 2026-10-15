import { RewardsEnabledGuard } from './rewards-enabled.guard';
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  adminVoucherInputSchema,
  adminVoucherListQuerySchema,
  adminVoucherStatePatchSchema,
  adminVoucherPriceChangeSchema,
  adminStockAdjustmentSchema,
  adminCodeImportRequestSchema,
  updateRewardsSettingsSchema,
  UpdateRewardsSettingsDto,
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
import { RewardsAdminCatalogService } from '../application/rewards-admin-catalog.service';

@Controller(['admin/rewards', 'api/admin/rewards'])
@UseGuards(RewardsEnabledGuard, SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminRewardsVouchersController {
  constructor(private readonly catalog: RewardsAdminCatalogService) {}

  @Get('vouchers')
  @Header('Cache-Control', 'no-store')
  async list(
    @Query(
      new ZodValidationPipe(
        adminVoucherListQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: unknown,
  ) {
    return createSuccessEnvelope(
      await this.catalog.list(
        query as Parameters<RewardsAdminCatalogService['list']>[0],
      ),
    );
  }

  @Get('brands')
  @Header('Cache-Control', 'no-store')
  async brands() {
    return createSuccessEnvelope(await this.catalog.brands());
  }

  @Get('vouchers/:id')
  @Header('Cache-Control', 'no-store')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return createSuccessEnvelope(await this.catalog.detail(id));
  }

  @Post('vouchers')
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminVoucherInputSchema)) body: unknown,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.catalog.create(
        admin.id,
        body as Parameters<RewardsAdminCatalogService['create']>[1],
        correlationId,
      ),
    );
  }

  @Put('vouchers/:id')
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminVoucherInputSchema)) body: unknown,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.catalog.update(
        id,
        admin.id,
        body as Parameters<RewardsAdminCatalogService['update']>[2],
        correlationId,
      ),
    );
  }

  @Patch('vouchers/:id')
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async patch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminVoucherStatePatchSchema)) body: unknown,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.catalog.patch(
        id,
        admin.id,
        body as Parameters<RewardsAdminCatalogService['patch']>[2],
        correlationId,
      ),
    );
  }

  @Post('vouchers/:id/price')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async price(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminVoucherPriceChangeSchema)) body: unknown,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.catalog.changePrice(
        id,
        admin.id,
        body as Parameters<RewardsAdminCatalogService['changePrice']>[2],
        correlationId,
      ),
    );
  }

  @Post('vouchers/:id/stock')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async stock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminStockAdjustmentSchema)) body: unknown,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.catalog.adjustStock(
        id,
        admin.id,
        body as Parameters<RewardsAdminCatalogService['adjustStock']>[2],
        correlationId,
      ),
    );
  }

  @Post('vouchers/:id/codes')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async codes(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminCodeImportRequestSchema)) body: unknown,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.catalog.importCodes(
        id,
        admin.id,
        body as Parameters<RewardsAdminCatalogService['importCodes']>[2],
        correlationId,
      ),
    );
  }

  @Get('settings')
  @Header('Cache-Control', 'no-store')
  async getSettings(@CurrentUser() admin: AuthenticatedUser) {
    return createSuccessEnvelope(await this.catalog.getSettings(admin.id));
  }

  @Put('settings')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async updateSettings(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateRewardsSettingsSchema))
    body: UpdateRewardsSettingsDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.catalog.updateSettings(admin.id, body, correlationId),
    );
  }
}
