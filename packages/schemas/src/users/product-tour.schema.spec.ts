import {
  PRODUCT_TOUR_IDS,
  productTourListSchema,
  updateProductTourSchema,
} from './product-tour.schema';

describe('Product tour contracts (canvas section 20)', () => {
  it('lists the four desktop tours', () => {
    expect([...PRODUCT_TOUR_IDS]).toEqual([
      'FIRST_SURVEY',
      'FIRST_PUBLISH',
      'TRACK_SURVEY',
      'FORM_BUILDER',
    ]);
  });

  it('accepts a valid update and rejects unknown keys or steps', () => {
    expect(
      updateProductTourSchema.safeParse({ status: 'COMPLETED', step: 4 })
        .success,
    ).toBe(true);
    expect(
      updateProductTourSchema.safeParse({ status: 'COMPLETED', step: 99 })
        .success,
    ).toBe(false);
    expect(
      updateProductTourSchema.safeParse({
        status: 'IN_PROGRESS',
        step: 0,
        userId: 'x',
      }).success,
    ).toBe(false);
  });

  it('parses the list envelope data', () => {
    expect(
      productTourListSchema.parse({
        tours: [
          {
            tourId: 'FORM_BUILDER',
            status: 'DISMISSED',
            step: 0,
            updatedAt: '2026-09-27T10:00:00.000Z',
          },
        ],
      }).tours,
    ).toHaveLength(1);
  });
});
