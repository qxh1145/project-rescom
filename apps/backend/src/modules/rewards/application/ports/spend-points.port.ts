export const SPEND_POINTS_PORT = Symbol('SPEND_POINTS_PORT');

export interface SpendPointsParams {
  userId: string;
  amount: number;
  idempotencyKey: string;
  description?: string;
}

export interface SpendPointsOptions {
  assertBeforeInsert?: () => Promise<void>;
}

export interface SpendPointsResult {
  journalId: string;
  idempotencyKey: string;
}

export interface SpendPointsPort {
  spendPoints(
    params: SpendPointsParams,
    options?: SpendPointsOptions,
  ): Promise<SpendPointsResult>;
}
