import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
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

@Controller('demographics')
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
}
