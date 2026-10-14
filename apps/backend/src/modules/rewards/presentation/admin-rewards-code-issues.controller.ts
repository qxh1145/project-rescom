import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  adminCodeIssueListQuerySchema,
  AdminCodeIssueListQuery,
  adminResolveCodeIssueSchema,
  AdminResolveCodeIssueDto,
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
import { RewardsAdminCodeIssuesService } from '../application/rewards-admin-code-issues.service';

@Controller(['admin/rewards', 'api/admin/rewards'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminRewardsCodeIssuesController {
  constructor(private readonly service: RewardsAdminCodeIssuesService) {}

  @Get('code-issues')
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser() admin: AuthenticatedUser,
    @Query(
      new ZodValidationPipe(
        adminCodeIssueListQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: AdminCodeIssueListQuery,
  ) {
    const result = await this.service.list(query, admin.id);
    return createSuccessEnvelope(result);
  }

  @Get('code-issues/:id')
  @Header('Cache-Control', 'no-store')
  async get(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.service.get(id, admin.id);
    return createSuccessEnvelope(result);
  }

  @Post('code-issues/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adminResolveCodeIssueSchema))
    body: AdminResolveCodeIssueDto,
  ) {
    const result = await this.service.resolve(id, body, {
      id: admin.id,
      name: admin.email ?? 'Admin',
    });
    return createSuccessEnvelope(result);
  }
}
