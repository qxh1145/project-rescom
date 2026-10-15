import { RewardsEnabledGuard } from './rewards-enabled.guard';
import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  voucherCatalogQuerySchema,
  VoucherCatalogQuery,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { RewardsCatalogService } from '../application/rewards-catalog.service';

@Controller(['rewards', 'api/rewards'])
@UseGuards(RewardsEnabledGuard, SessionAuthGuard)
export class RewardsCatalogController {
  constructor(private readonly catalog: RewardsCatalogService) {}

  @Get('vouchers')
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(
      new ZodValidationPipe(
        voucherCatalogQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: VoucherCatalogQuery,
  ) {
    return createSuccessEnvelope(await this.catalog.list(user.id, query));
  }

  @Get('vouchers/:id')
  @Header('Cache-Control', 'no-store')
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return createSuccessEnvelope(await this.catalog.detail(user.id, id));
  }

  @Get('flash-sales')
  @Header('Cache-Control', 'no-store')
  async flashSales() {
    return createSuccessEnvelope(await this.catalog.flashSalesList());
  }
}
