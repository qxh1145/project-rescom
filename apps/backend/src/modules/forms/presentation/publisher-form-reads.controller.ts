import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  publisherProgressQuerySchema,
  PublisherProgressQuery,
} from '@rescom/schemas';
import { PublisherFormReadsService } from '../application/publisher-form-reads.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

/**
 * Story IR.4a (FR-39): Research-owned Publisher reads — progress and one
 * version's detail. Owner only (404 `FORM_NOT_FOUND` for anybody else,
 * Admins included). Responses and analytics are Participation-owned
 * (`PublisherResultsController`).
 */
@Controller(['forms', 'api/forms'])
@UseGuards(SessionAuthGuard)
export class PublisherFormReadsController {
  constructor(private readonly reads: PublisherFormReadsService) {}

  @Get(':id/progress')
  @Header('Cache-Control', 'private, no-store')
  async getProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(
      new ZodValidationPipe(
        publisherProgressQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: PublisherProgressQuery,
  ) {
    const progress = await this.reads.getProgress(
      id,
      { userId: user.id },
      query.range,
    );
    return createSuccessEnvelope(progress);
  }

  @Get(':id/versions/:versionId')
  @Header('Cache-Control', 'private, no-store')
  async getVersionDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    const version = await this.reads.getVersionDetail(id, versionId, {
      userId: user.id,
    });
    return createSuccessEnvelope(version);
  }
}
