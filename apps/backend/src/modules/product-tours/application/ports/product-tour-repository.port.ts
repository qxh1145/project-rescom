import type { ProductTourId, ProductTourStatus } from '@rescom/schemas';

export const PRODUCT_TOUR_REPOSITORY_PORT = Symbol(
  'PRODUCT_TOUR_REPOSITORY_PORT',
);

export interface ProductTourProgressRecord {
  userId: string;
  tourId: ProductTourId;
  status: ProductTourStatus;
  step: number;
  updatedAt: Date;
}

export interface ProductTourRepositoryPort {
  listForUser(userId: string): Promise<ProductTourProgressRecord[]>;
  upsert(
    userId: string,
    tourId: ProductTourId,
    data: { status: ProductTourStatus; step: number },
  ): Promise<ProductTourProgressRecord>;
}
