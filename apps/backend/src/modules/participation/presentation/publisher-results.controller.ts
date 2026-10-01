import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  publisherAnalyticsQuerySchema,
  PublisherAnalyticsQuery,
  publisherResponsesQuerySchema,
  PublisherResponsesQuery,
} from '@rescom/schemas';
import { PublisherResultsService } from '../application/publisher-results.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

/**
 * Story IR.4a (FR-40, AD-16): Participation-owned Publisher reads of the
 * Responses of one pinned version, under the `forms/` URL prefix (like
 * `ParticipationController`'s `forms/:id/attempts`). Owner only: 404
 * `FORM_NOT_FOUND` for anybody else, Admins included. Never cached.
 */
@Controller(['forms', 'api/forms'])
@UseGuards(SessionAuthGuard)
export class PublisherResultsController {
  constructor(private readonly results: PublisherResultsService) {}

  @Get(':id/responses')
  @Header('Cache-Control', 'private, no-store')
  async getResponses(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(
      new ZodValidationPipe(
        publisherResponsesQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: PublisherResponsesQuery,
  ) {
    const page = await this.results.getResponsesPage(
      id,
      { userId: user.id },
      query,
    );
    return createSuccessEnvelope(page);
  }

  @Get(':id/analytics')
  @Header('Cache-Control', 'private, no-store')
  async getAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(
      new ZodValidationPipe(
        publisherAnalyticsQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: PublisherAnalyticsQuery,
  ) {
    const analytics = await this.results.getAnalytics(
      id,
      { userId: user.id },
      query,
    );
    return createSuccessEnvelope(analytics);
  }
}
