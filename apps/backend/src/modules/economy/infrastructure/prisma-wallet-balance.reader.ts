import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import { WalletBalancePort } from '../../rewards/application/ports/wallet-balance.port';

@Injectable()
export class PrismaWalletBalanceReader implements WalletBalancePort {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(
    userId: string,
  ): Promise<{ available: number; pending: number }> {
    const accounts = await currentClient(this.prisma).ledgerAccount.findMany({
      where: {
        userId,
        currency: 'POINTS',
        accountClass: { in: ['USER_AVAILABLE', 'PENDING'] },
      },
      select: { accountClass: true, balance: true },
    });
    return {
      available:
        accounts.find((account) => account.accountClass === 'USER_AVAILABLE')
          ?.balance ?? 0,
      pending:
        accounts.find((account) => account.accountClass === 'PENDING')
          ?.balance ?? 0,
    };
  }
}
