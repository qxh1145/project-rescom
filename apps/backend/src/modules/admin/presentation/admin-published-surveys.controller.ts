import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ListPublishedSurveysQuery,
  PublishedSurveyPage,
  SetSurveyPinnedInput,
  SurveyPinResult,
  listPublishedSurveysQuerySchema,
  setSurveyPinnedSchema,
} from '@rescom/schemas';
import { AdminPublishedSurveysService } from '../application/admin-published-surveys.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser, Roles } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import {
  ApiResponse,
  createSuccessEnvelope,
} from '../../../common/http/response.envelope';

/** Admin · published surveys and Marketplace pinning. Contract: `published-surveys.schema.ts`. */
@Controller(['admin/surveys', 'api/admin/surveys'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminPublishedSurveysController {
  constructor(private readonly service: AdminPublishedSurveysService) {}

  @Get('published')
  @Header('Cache-Control', 'no-store')
  async list(
    @Query(
      new ZodValidationPipe(
        listPublishedSurveysQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListPublishedSurveysQuery,
  ): Promise<ApiResponse<PublishedSurveyPage>> {
    return createSuccessEnvelope(await this.service.list(query));
  }

  @Put(':formId/pin')
  @UseGuards(JsonOnlyGuard, CsrfGuard)
  async setPinned(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('formId', ParseUUIDPipe) formId: string,
    @Body(new ZodValidationPipe(setSurveyPinnedSchema))
    body: SetSurveyPinnedInput,
  ): Promise<ApiResponse<SurveyPinResult>> {
    return createSuccessEnvelope(
      await this.service.setPinned(admin.id, formId, body.pinned),
    );
  }
}
