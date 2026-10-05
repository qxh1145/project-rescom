import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  updateUserProfileSchema,
  UpdateUserProfileInput,
} from '@rescom/schemas';
import { UserProfileService } from '../application/user-profile.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

/** FR-9 profile of the signed-in user (Story IR.4b part A). */
@Controller(['users/me/profile', 'api/users/me/profile'])
@UseGuards(SessionAuthGuard)
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.userProfileService.getOwnProfile(user.id);
    return createSuccessEnvelope(result);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(updateUserProfileSchema))
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserProfileInput,
  ) {
    const result = await this.userProfileService.updateOwnProfile(user.id, dto);
    return createSuccessEnvelope(result);
  }
}
