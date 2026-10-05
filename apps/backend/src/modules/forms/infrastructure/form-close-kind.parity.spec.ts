import { $Enums } from '@prisma/client';
import { formCloseKindEnum } from '@rescom/schemas';

/**
 * Story IR.2b Task 1.4: the shared Zod enum must equal the generated Prisma
 * enum (values and order), not a hand-written copy, so a drift between
 * `schema.prisma` and `@rescom/schemas` fails the build. Modelled on
 * `notifications/infrastructure/notification-type.parity.spec.ts`.
 */
describe('FormCloseKind parity (decision E8-D1, IR.2b, plan 2.3)', () => {
  it('formCloseKindEnum equals the Prisma FormCloseKind enum', () => {
    expect([...formCloseKindEnum.options]).toEqual(
      Object.values($Enums.FormCloseKind),
    );
  });

  it('includes the system close kinds DEADLINE and QUOTA', () => {
    expect(formCloseKindEnum.options).toEqual(
      expect.arrayContaining(['DEADLINE', 'QUOTA']),
    );
  });
});
