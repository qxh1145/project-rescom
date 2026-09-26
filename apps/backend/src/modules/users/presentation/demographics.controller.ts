import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  submitDemographicSurveySchema,
  SubmitDemographicSurveyInput,
  updateDemographicProfileSchema,
  UpdateDemographicProfileInput,
} from '@rescom/schemas';
import { DemographicsService } from '../application/demographics.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

@Controller(['demographics', 'api/demographics'])
@UseGuards(SessionAuthGuard)
export class DemographicsController {
  constructor(private readonly demographicsService: DemographicsService) {}

  @Get()
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.demographicsService.getProfile(user.id);
    return createSuccessEnvelope(result);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(updateDemographicProfileSchema))
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDemographicProfileInput,
  ) {
    const result = await this.demographicsService.updateProfile(user.id, dto);
    return createSuccessEnvelope(result, {
      message: 'Demographic profile updated successfully',
    });
  }

  /**
   * Mandatory Demographic Survey submission (Story 7.1, FR-6). Every field is
   * required; the response tells the client to open the Marketplace
   * activation step (FR-7).
   */
  @Post('survey')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(submitDemographicSurveySchema))
  async submitSurvey(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitDemographicSurveyInput,
  ) {
    const result = await this.demographicsService.submitMandatorySurvey(
      user.id,
      dto,
    );
    return createSuccessEnvelope(result, {
      message: 'Mandatory demographic survey completed',
    });
  }
}
