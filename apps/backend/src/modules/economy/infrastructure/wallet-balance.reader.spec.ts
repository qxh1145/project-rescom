import { InMemoryWalletBalanceReader } from './in-memory-wallet-balance.reader';
import { PrismaWalletBalanceReader } from './prisma-wallet-balance.reader';
import { PrismaService } from '../../../common/database/prisma.service';

describe('wallet balance readers', () => {
  it('does not create accounts for a missing viewer', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const reader = new PrismaWalletBalanceReader({
      ledgerAccount: { findMany },
    } as unknown as PrismaService);
    expect(
      await reader.getBalance('00000000-0000-4000-8000-000000000001'),
    ).toEqual({ available: 0, pending: 0, refundHold: 0 });
    expect(
      await new InMemoryWalletBalanceReader().getBalance('missing'),
    ).toEqual({ available: 0, pending: 0, refundHold: 0 });
  });

  it('returns only available and pending POINTS accounts', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { accountClass: 'PENDING', balance: 20 },
      { accountClass: 'USER_AVAILABLE', balance: 45 },
    ]);
    const reader = new PrismaWalletBalanceReader({
      ledgerAccount: { findMany },
    } as unknown as PrismaService);
    expect(await reader.getBalance('user')).toEqual({
      available: 45,
      pending: 20,
      refundHold: 0,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user',
        currency: 'POINTS',
        accountClass: { in: ['USER_AVAILABLE', 'PENDING', 'REFUND_HOLD'] },
      },
      select: { accountClass: true, balance: true },
    });
  });
});
