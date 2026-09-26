import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MarketplaceService } from '../application/marketplace.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import {
  MarketplaceFeedQueryDto,
  marketplaceFeedQuerySchema,
} from '@rescom/schemas';

/** Invalid feed query parameters are a 400 VALIDATION_ERROR, never a 500. */
export const marketplaceFeedQueryPipe = new ZodValidationPipe(
  marketplaceFeedQuerySchema,
  'VALIDATION_ERROR',
  'query',
);

@Controller('marketplace')
@UseGuards(SessionAuthGuard)
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('feed')
  async getFeed(
    @CurrentUser() user: AuthenticatedUser,
    @Query(marketplaceFeedQueryPipe) query?: MarketplaceFeedQueryDto,
  ) {
    const feed = await this.marketplaceService.getFeed(user.id, query);
    return createSuccessEnvelope(feed);
  }
}
