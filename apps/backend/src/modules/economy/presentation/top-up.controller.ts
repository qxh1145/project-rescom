import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateTopUpRequestInput,
  ListTopUpRequestsQuery,
  createTopUpRequestSchema,
  listTopUpRequestsQuerySchema,
} from '@rescom/schemas';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { TopUpService } from '../application/top-up.service';

/**
 * Manual Point top-up for the authenticated user (Story 6.6, FR-34).
 * Every route acts only on the caller's own requests.
 */
@Controller(['economy/top-ups', 'api/economy/top-ups'])
@UseGuards(SessionAuthGuard)
export class TopUpController {
  constructor(private readonly topUpService: TopUpService) {}

  /** Creates a "Pending Payment" request with bank info and transfer syntax. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTopUpRequestSchema))
    body: CreateTopUpRequestInput,
  ) {
    const request = await this.topUpService.createRequest(user.id, body);
    return createSuccessEnvelope(request);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(
      new ZodValidationPipe(
        listTopUpRequestsQuerySchema,
        'VALIDATION_ERROR',
        'query',
      ),
    )
    query: ListTopUpRequestsQuery,
  ) {
    const result = await this.topUpService.listMyRequests(user.id, query);
    return createSuccessEnvelope(result);
  }
}
