import type { ProductTourId, ProductTourStatus } from '@rescom/schemas';
import type {
  ProductTourProgressRecord,
  ProductTourRepositoryPort,
} from '../application/ports/product-tour-repository.port';

/** Test double for `ProductTourRepositoryPort`. */
export class InMemoryProductTourRepository implements ProductTourRepositoryPort {
  private readonly rows = new Map<string, ProductTourProgressRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  listForUser(userId: string): Promise<ProductTourProgressRecord[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.userId === userId),
    );
  }

  upsert(
    userId: string,
    tourId: ProductTourId,
    data: { status: ProductTourStatus; step: number },
  ): Promise<ProductTourProgressRecord> {
    const record: ProductTourProgressRecord = {
      userId,
      tourId,
      status: data.status,
      step: data.step,
      updatedAt: this.now(),
    };
    this.rows.set(`${userId}:${tourId}`, record);
    return Promise.resolve(record);
  }
}
