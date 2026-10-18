export const WALLET_BALANCE_PORT = Symbol('WALLET_BALANCE_PORT');

export interface WalletBalancePort {
  getBalance(
    userId: string,
  ): Promise<{ available: number; pending: number; refundHold?: number }>;
}
