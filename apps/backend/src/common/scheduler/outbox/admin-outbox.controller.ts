import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ListOutboxDeadLettersQuery,
  listOutboxDeadLettersQuerySchema,
  OutboxDeadLetterPage,
  OutboxRedriveResult,
  redriveOutboxEventSchema,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../../modules/auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../../modules/auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../../modules/auth/presentation/guards/csrf.guard';
import {
  CurrentUser,
  Roles,
} from '../../../modules/auth/presentation/decorators';
import { AuthenticatedUser } from '../../../modules/auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../http/json-only.guard';
import { ParseUUIDPipe } from '../../http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../http/response.envelope';
import { CLOCK, Clock } from '../../time/clock';
import {
  OUTBOX_CLAIM_REPOSITORY,
  OutboxClaimRepository,
} from './outbox-claim.repository';

/**
 * Story IR.2b Task 4.7 (AD-10 "audited re-drive", decision Q9): minimal Admin
 * dead-letter operations. The list never returns the payload. A re-drive
 * keeps the event identity (same id and idempotency key), resets `attempts`
 * and makes it due now; it is written to the Admin audit log. No "skip".
 */
@Controller(['admin/outbox', 'api/admin/outbox'])
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminOutboxController {
  constructor(
    @Inject(OUTBOX_CLAIM_REPOSITORY)
    private readonly outbox: OutboxClaimRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('dead-letters')
  async listDeadLetters(
    @Query(
      new ZodValidationPipe(
        listOutboxDeadLettersQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListOutboxDeadLettersQuery,
  ) {
    const page = await this.outbox.listDeadLetters(
      query.limit,
      query.cursor ?? null,
    );
    const result: OutboxDeadLetterPage = {
      items: page.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
    return createSuccessEnvelope(result);
  }

  @Post('events/:eventId/redrive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async redrive(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(redriveOutboxEventSchema)) _body: unknown,
  ) {
    // Review LOW-13: the state change and its audit row commit together.
    const outcome = await this.outbox.redrive(
      eventId,
      this.clock.now(),
      admin.id,
    );
    if (outcome === 'NOT_FOUND') {
      throw new NotFoundException({
        code: 'OUTBOX_EVENT_NOT_FOUND',
        message: 'Outbox event not found.',
      });
    }
    if (outcome === 'NOT_DEAD_LETTER') {
      throw new ConflictException({
        code: 'OUTBOX_EVENT_NOT_DEAD_LETTER',
        message: 'Only a dead-lettered Outbox event can be re-driven.',
      });
    }
    const result: OutboxRedriveResult = { eventId, status: 'PENDING' };
    return createSuccessEnvelope(result);
  }
}
