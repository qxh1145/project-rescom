import { $Enums } from '@prisma/client';
import { EMAIL_DELIVERY_STATUSES } from '@rescom/schemas';

/** Story IR.4b B-T1: the shared list must equal the generated Prisma enum. */
describe('EmailDeliveryStatus parity (Story IR.4b B5)', () => {
  it('EMAIL_DELIVERY_STATUSES equals the Prisma EmailDeliveryStatus enum', () => {
    expect([...EMAIL_DELIVERY_STATUSES]).toEqual(
      Object.values($Enums.EmailDeliveryStatus),
    );
  });
});
