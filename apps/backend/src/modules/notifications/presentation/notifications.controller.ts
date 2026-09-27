import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ListNotificationsQuery,
  listNotificationsQuerySchema,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { NotificationsService } from '../application/notifications.service';

/**
 * Notification center for the authenticated user (Story 9.6, FR-57).
 * Every route acts only on the caller's own notifications.
 */
@Controller(['notifications', 'api/notifications'])
@UseGuards(SessionAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(
      new ZodValidationPipe(
        listNotificationsQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListNotificationsQuery,
  ) {
    const result = await this.notificationsService.list(user.id, query);
    return createSuccessEnvelope(result);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.notificationsService.getUnreadCount(user.id);
    return createSuccessEnvelope(result);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.notificationsService.markAllRead(user.id);
    return createSuccessEnvelope(result);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.notificationsService.markRead(user.id, id);
    return createSuccessEnvelope(result);
  }
}
