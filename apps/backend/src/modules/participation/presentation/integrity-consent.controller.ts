import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  acceptIntegrityConsentInputSchema,
  type AcceptIntegrityConsentInput,
} from '@rescom/schemas';
import { IntegrityConsentService } from '../application/integrity-consent.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

/**
 * Integrity telemetry notice (Figma 14): the caller's own consent status and
 * its acceptance. Session-only; the acceptance is a CSRF-protected JSON
 * command, idempotent per notice version.
 */
@Controller(['integrity/consent', 'api/integrity/consent'])
@UseGuards(SessionAuthGuard)
export class IntegrityConsentController {
  constructor(
    private readonly integrityConsentService: IntegrityConsentService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async getConsent(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.integrityConsentService.getConsent(user.id);
    return createSuccessEnvelope(result);
  }

  /** 200 for a new acceptance and for a replay (original `acceptedAt`). */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async acceptConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(acceptIntegrityConsentInputSchema))
    body: AcceptIntegrityConsentInput,
  ) {
    const result = await this.integrityConsentService.acceptConsent(
      user.id,
      body,
    );
    return createSuccessEnvelope(result);
  }
}
