import { $Enums } from '@prisma/client';
import { SESSION_REVOKE_REASONS } from '../domain/session.entity';

/** Plan 5.6: the domain list must equal the generated Prisma enum. */
describe('SessionRevokeReason parity (plan 5.6)', () => {
  it('SESSION_REVOKE_REASONS equals the Prisma SessionRevokeReason enum', () => {
    expect([...SESSION_REVOKE_REASONS]).toEqual(
      Object.values($Enums.SessionRevokeReason),
    );
  });
});
