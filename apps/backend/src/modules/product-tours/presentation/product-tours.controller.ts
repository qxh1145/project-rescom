import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  productTourIdSchema,
  updateProductTourSchema,
  type ProductTourId,
  type UpdateProductTourInput,
} from '@rescom/schemas';
import { ProductToursService } from '../application/product-tours.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';

/** Interactive product tours (canvas section 20): the caller's own progress. */
@Controller(['product-tours', 'api/product-tours'])
@UseGuards(SessionAuthGuard)
export class ProductToursController {
  constructor(private readonly productTours: ProductToursService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return createSuccessEnvelope(await this.productTours.list(user.id));
  }

  @Put(':tourId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param(
      'tourId',
      new ZodValidationPipe(productTourIdSchema, 'VALIDATION_ERROR', 'param'),
    )
    tourId: ProductTourId,
    @Body(new ZodValidationPipe(updateProductTourSchema))
    body: UpdateProductTourInput,
  ) {
    return createSuccessEnvelope(
      await this.productTours.update(user.id, tourId, body),
    );
  }
}
