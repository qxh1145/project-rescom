import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MarketplaceService } from '../application/marketplace.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { marketplaceFeedQuerySchema } from '@rescom/schemas';

@Controller('marketplace')
@UseGuards(SessionAuthGuard)
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('feed')
  async getFeed(
    @CurrentUser() user: AuthenticatedUser,
    @Query() rawQuery?: Record<string, unknown>,
  ) {
    const query = marketplaceFeedQuerySchema.parse(rawQuery ?? {});
    const feed = await this.marketplaceService.getFeed(user.id, query);
    return createSuccessEnvelope(feed);
  }
}
