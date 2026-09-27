import { Injectable } from '@nestjs/common';
import type { ProductTourId, ProductTourStatus } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  ProductTourProgressRecord,
  ProductTourRepositoryPort,
} from '../application/ports/product-tour-repository.port';

const SELECT = {
  userId: true,
  tourId: true,
  status: true,
  step: true,
  updatedAt: true,
} as const;

@Injectable()
export class PrismaProductTourRepository implements ProductTourRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<ProductTourProgressRecord[]> {
    return this.prisma.productTourProgress.findMany({
      where: { userId },
      select: SELECT,
      orderBy: { tourId: 'asc' },
    });
  }

  async upsert(
    userId: string,
    tourId: ProductTourId,
    data: { status: ProductTourStatus; step: number },
  ): Promise<ProductTourProgressRecord> {
    return this.prisma.productTourProgress.upsert({
      where: { userId_tourId: { userId, tourId } },
      create: { userId, tourId, status: data.status, step: data.step },
      update: { status: data.status, step: data.step },
      select: SELECT,
    });
  }
}
