import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ProductToursService } from './application/product-tours.service';
import {
  PRODUCT_TOUR_REPOSITORY_PORT,
  ProductTourRepositoryPort,
} from './application/ports/product-tour-repository.port';
import { PrismaProductTourRepository } from './infrastructure/prisma-product-tour.repository';
import { ProductToursController } from './presentation/product-tours.controller';

/** Interactive product tours (canvas section 20): per-account tour progress. */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ProductToursController],
  providers: [
    {
      provide: PRODUCT_TOUR_REPOSITORY_PORT,
      useClass: PrismaProductTourRepository,
    },
    {
      provide: ProductToursService,
      useFactory: (repository: ProductTourRepositoryPort) =>
        new ProductToursService(repository),
      inject: [PRODUCT_TOUR_REPOSITORY_PORT],
    },
  ],
})
export class ProductToursModule {}
