import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UsePipes,
} from '@nestjs/common';
import { Request } from 'express';
import { PublicFormsService } from '../application/public-forms.service';
import { guestSubmissionSchema, GuestSubmissionInput } from '@rescom/schemas';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

@Controller(['public/forms', 'api/public/forms'])
export class PublicFormsController {
  constructor(private readonly publicFormsService: PublicFormsService) {}

  @Get(':id')
  async getPublicForm(@Param('id', ParseUUIDPipe) id: string) {
    const form = await this.publicFormsService.getPublicForm(id);
    return createSuccessEnvelope(form);
  }

  @Post(':id/submissions')
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(guestSubmissionSchema))
  async submitGuestResponse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GuestSubmissionInput,
    @Req() req: Request,
  ) {
    // Bug 3.3: never read X-Forwarded-For here. Express derives `req.ip` from
    // it only for the trusted proxy hops (`TRUST_PROXY_HOPS`, main.ts), so a
    // client cannot spoof its rate-limit key.
    const ip = req.ip || 'unknown';

    const result = await this.publicFormsService.submitGuestResponse(
      id,
      body,
      ip,
    );
    return createSuccessEnvelope(result, {
      message: 'Guest submission recorded successfully',
    });
  }
}
