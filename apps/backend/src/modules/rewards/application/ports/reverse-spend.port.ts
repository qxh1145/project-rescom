export const REVERSE_SPEND_PORT = Symbol('REVERSE_SPEND_PORT');

export interface ReverseSpendParams {
  journalId: string;
  idempotencyKey: string;
  reason?: string;
}

export interface ReverseSpendResult {
  journalId: string;
}

export interface ReverseSpendPort {
  reverseSpend(params: ReverseSpendParams): Promise<ReverseSpendResult>;
}
