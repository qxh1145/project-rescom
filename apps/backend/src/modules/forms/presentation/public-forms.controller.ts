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

@Controller('public/forms')
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
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      (typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : Array.isArray(forwarded)
          ? forwarded[0]
          : null) ||
      req.ip ||
      req.socket?.remoteAddress ||
      '127.0.0.1';

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
