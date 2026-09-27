import { Test } from '@nestjs/testing';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { BadRequestException } from '@nestjs/common';
import { productTourIdSchema } from '@rescom/schemas';
import { ProductToursController } from './product-tours.controller';
import { ProductToursService } from '../application/product-tours.service';
import { InMemoryProductTourRepository } from '../infrastructure/in-memory-product-tour.repository';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';

describe('ProductToursController', () => {
  const user: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'respondent@example.com',
    role: 'RESPONDENT',
    status: 'ACTIVE',
  };
  let controller: ProductToursController;

  beforeEach(async () => {
    const service = new ProductToursService(
      new InMemoryProductTourRepository(
        () => new Date('2026-09-27T10:00:00.000Z'),
      ),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductToursController],
      providers: [{ provide: ProductToursService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(ProductToursController);
  });

  it('is registered under both the bare and api/ prefixes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ProductToursController)).toEqual([
      'product-tours',
      'api/product-tours',
    ]);
  });

  it('protects writes with CSRF and JSON-only guards', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        ProductToursController.prototype.update,
      ),
    ).toEqual([CsrfGuard, JsonOnlyGuard]);
  });

  it('saves and lists the caller progress', async () => {
    const saved = await controller.update(user, 'FIRST_SURVEY', {
      status: 'IN_PROGRESS',
      step: 3,
    });
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({
      tourId: 'FIRST_SURVEY',
      status: 'IN_PROGRESS',
      step: 3,
    });

    const listed = await controller.list(user);
    expect(listed.data?.tours).toHaveLength(1);
  });

  it('rejects an unknown tour id', () => {
    const pipe = new ZodValidationPipe(
      productTourIdSchema,
      'VALIDATION_ERROR',
      'param',
    );
    expect(() =>
      pipe.transform('SOMETHING_ELSE', { type: 'param', data: 'tourId' }),
    ).toThrow(BadRequestException);
  });
});
