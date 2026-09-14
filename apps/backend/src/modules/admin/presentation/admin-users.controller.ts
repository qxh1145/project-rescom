import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  UsePipes,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import {
  listUsersQuerySchema,
  ListUsersQuery,
  updateUserStatusSchema,
  UpdateUserStatusDto,
  updateUserRoleSchema,
  UpdateUserRoleDto,
  AdminUser,
} from '@rescom/schemas';
import { UserAdminService } from '../../users/application/user-admin.service';
import { User } from '../../users/domain/user.entity';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { Roles, CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

function toAdminUserResponse(user: User): AdminUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

@Controller('admin/users')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminUsersController {
  constructor(private readonly userAdminService: UserAdminService) {}

  @Get()
  @UsePipes(
    new ZodValidationPipe(listUsersQuerySchema, 'VALIDATION_ERROR', 'query'),
  )
  async listUsers(@Query() query: ListUsersQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { users, total } = await this.userAdminService.listUsers({
      page,
      limit,
      search: query.search,
      role: query.role,
      status: query.status,
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return createSuccessEnvelope({
      items: users.map(toAdminUserResponse),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  }

  @Get(':id')
  async getUserById(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.userAdminService.getUserById(id);
    return createSuccessEnvelope({
      user: toAdminUserResponse(user),
    });
  }

  @Patch(':id/status')
  @UseGuards(JsonOnlyGuard, CsrfGuard)
  @UsePipes(
    new ZodValidationPipe(updateUserStatusSchema, 'VALIDATION_ERROR', 'body'),
  )
  async updateUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const auditMetadata = {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };

    const user = await this.userAdminService.updateUserStatus(
      actor.id,
      id,
      dto.status,
      auditMetadata,
    );

    return createSuccessEnvelope({
      user: toAdminUserResponse(user),
    });
  }

  @Patch(':id/role')
  @UseGuards(JsonOnlyGuard, CsrfGuard)
  @UsePipes(
    new ZodValidationPipe(updateUserRoleSchema, 'VALIDATION_ERROR', 'body'),
  )
  async updateUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const auditMetadata = {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };

    const user = await this.userAdminService.updateUserRole(
      actor.id,
      id,
      dto.role,
      auditMetadata,
    );

    return createSuccessEnvelope({
      user: toAdminUserResponse(user),
    });
  }
}
