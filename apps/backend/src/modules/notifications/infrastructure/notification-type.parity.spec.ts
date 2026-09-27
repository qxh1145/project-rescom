import { $Enums } from '@prisma/client';
import { NOTIFICATION_TYPES } from '@rescom/schemas';

/**
 * Epic 9 review P12: the shared Zod list must equal the generated Prisma enum,
 * not a hand-written copy, so a drift between `schema.prisma` and
 * `@rescom/schemas` fails the build.
 */
describe('NotificationType parity (Story 9.6 AC1.1)', () => {
  it('NOTIFICATION_TYPES equals the Prisma NotificationType enum', () => {
    expect([...NOTIFICATION_TYPES]).toEqual(
      Object.values($Enums.NotificationType),
    );
  });
});
