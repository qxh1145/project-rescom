import { ProductToursService } from './product-tours.service';
import { InMemoryProductTourRepository } from '../infrastructure/in-memory-product-tour.repository';

describe('ProductToursService (canvas section 20)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUser = '22222222-2222-4222-8222-222222222222';
  const now = new Date('2026-09-27T10:00:00.000Z');
  let service: ProductToursService;

  beforeEach(() => {
    service = new ProductToursService(
      new InMemoryProductTourRepository(() => now),
    );
  });

  it('lists nothing for a new user', async () => {
    await expect(service.list(userId)).resolves.toEqual({ tours: [] });
  });

  it('saves progress per user and tour', async () => {
    await service.update(userId, 'FIRST_SURVEY', {
      status: 'IN_PROGRESS',
      step: 2,
    });
    await service.update(otherUser, 'FORM_BUILDER', {
      status: 'DISMISSED',
      step: 0,
    });

    await expect(service.list(userId)).resolves.toEqual({
      tours: [
        {
          tourId: 'FIRST_SURVEY',
          status: 'IN_PROGRESS',
          step: 2,
          updatedAt: now.toISOString(),
        },
      ],
    });
  });

  it('keeps a completed tour completed when it is replayed or dismissed', async () => {
    await service.update(userId, 'FIRST_PUBLISH', {
      status: 'COMPLETED',
      step: 4,
    });
    const replay = await service.update(userId, 'FIRST_PUBLISH', {
      status: 'IN_PROGRESS',
      step: 1,
    });
    expect(replay).toMatchObject({ status: 'COMPLETED', step: 1 });

    const dismissed = await service.update(userId, 'FIRST_PUBLISH', {
      status: 'DISMISSED',
      step: 2,
    });
    expect(dismissed).toMatchObject({ status: 'COMPLETED', step: 2 });
  });

  it('lets a dismissed tour be resumed', async () => {
    await service.update(userId, 'TRACK_SURVEY', {
      status: 'DISMISSED',
      step: 1,
    });
    await expect(
      service.update(userId, 'TRACK_SURVEY', {
        status: 'IN_PROGRESS',
        step: 1,
      }),
    ).resolves.toMatchObject({ status: 'IN_PROGRESS' });
  });
});
