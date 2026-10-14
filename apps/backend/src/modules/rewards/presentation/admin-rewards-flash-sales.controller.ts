import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  adminFlashEndRequestSchema,
  AdminFlashEndRequestDto,
  adminFlashSaleInputSchema,
  AdminFlashSaleInputDto,
  adminFlashSaleListQuerySchema,
  AdminFlashSaleListQueryDto,
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
import { RewardsAdminFlashService } from '../application/rewards-admin-flash.service';

@Controller(['admin/rewards', 'api/admin/rewards'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminRewardsFlashSalesController {
  constructor(private readonly adminFlash: RewardsAdminFlashService) {}

  @Get('flash-sales')
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser() admin: AuthenticatedUser,
    @Query(
      new ZodValidationPipe(
        adminFlashSaleListQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: AdminFlashSaleListQueryDto,
  ) {
    return createSuccessEnvelope(await this.adminFlash.list(admin.id, query));
  }

  @Post('flash-sales')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminFlashSaleInputSchema))
    body: AdminFlashSaleInputDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.adminFlash.create(admin.id, body, correlationId),
    );
  }

  @Get('flash-sales/:id')
  @Header('Cache-Control', 'no-store')
  async detail(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return createSuccessEnvelope(await this.adminFlash.get(admin.id, id));
  }

  @Put('flash-sales/:id')
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async update(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adminFlashSaleInputSchema))
    body: AdminFlashSaleInputDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.adminFlash.update(id, admin.id, body, correlationId),
    );
  }

  @Post('flash-sales/:id/end')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async endEarly(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adminFlashEndRequestSchema))
    body: AdminFlashEndRequestDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return createSuccessEnvelope(
      await this.adminFlash.endEarly(id, admin.id, body, correlationId),
    );
  }
}
