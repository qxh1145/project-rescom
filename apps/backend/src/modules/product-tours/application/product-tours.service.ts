import type {
  ProductTourId,
  ProductTourListDto,
  ProductTourProgressDto,
  UpdateProductTourInput,
} from '@rescom/schemas';
import type {
  ProductTourProgressRecord,
  ProductTourRepositoryPort,
} from './ports/product-tour-repository.port';

function toDto(record: ProductTourProgressRecord): ProductTourProgressDto {
  return {
    tourId: record.tourId,
    status: record.status,
    step: record.step,
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Interactive product tours (canvas section 20). Keeps, per account, how far
 * each tour got so it is not offered twice and can resume on any device.
 *
 * A COMPLETED tour stays completed: a later IN_PROGRESS write (the user
 * replays it from "Xem lại") only moves the step, and a DISMISSED write keeps
 * it COMPLETED as well.
 */
export class ProductToursService {
  constructor(private readonly repository: ProductTourRepositoryPort) {}

  async list(userId: string): Promise<ProductTourListDto> {
    const rows = await this.repository.listForUser(userId);
    return { tours: rows.map(toDto) };
  }

  async update(
    userId: string,
    tourId: ProductTourId,
    input: UpdateProductTourInput,
  ): Promise<ProductTourProgressDto> {
    const current = (await this.repository.listForUser(userId)).find(
      (row) => row.tourId === tourId,
    );
    const status = current?.status === 'COMPLETED' ? 'COMPLETED' : input.status;
    const saved = await this.repository.upsert(userId, tourId, {
      status,
      step: input.step,
    });
    return toDto(saved);
  }
}
