import { $Enums } from '@prisma/client';
import { USER_GOALS } from '@rescom/schemas';

/** The shared Zod list must equal the generated Prisma enum (Story IR.4b part A). */
describe('UserGoal enum parity', () => {
  it('USER_GOALS equals the Prisma UserGoal enum', () => {
    expect([...USER_GOALS]).toEqual(Object.values($Enums.UserGoal));
  });
});
