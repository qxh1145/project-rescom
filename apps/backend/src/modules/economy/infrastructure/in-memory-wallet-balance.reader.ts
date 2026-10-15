import { WalletBalancePort } from '../../rewards/application/ports/wallet-balance.port';

export class InMemoryWalletBalanceReader implements WalletBalancePort {
  constructor(
    private readonly balances = new Map<
      string,
      { available: number; pending: number }
    >(),
  ) {}

  async getBalance(
    userId: string,
  ): Promise<{ available: number; pending: number }> {
    return this.balances.get(userId) ?? { available: 0, pending: 0 };
  }
}
