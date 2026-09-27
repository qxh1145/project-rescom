import { $Enums } from '@prisma/client';
import { PRODUCT_TOUR_IDS, PRODUCT_TOUR_STATUSES } from '@rescom/schemas';

/** The shared Zod lists must equal the generated Prisma enums. */
describe('Product tour enum parity', () => {
  it('PRODUCT_TOUR_IDS equals the Prisma ProductTourId enum', () => {
    expect([...PRODUCT_TOUR_IDS]).toEqual(Object.values($Enums.ProductTourId));
  });

  it('PRODUCT_TOUR_STATUSES equals the Prisma ProductTourStatus enum', () => {
    expect([...PRODUCT_TOUR_STATUSES]).toEqual(
      Object.values($Enums.ProductTourStatus),
    );
  });
});
