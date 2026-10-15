export const FRAUD_FLAG_PORT = Symbol('FRAUD_FLAG_PORT');

export interface RecordFlashAfterTopUpParams {
  userId: string;
  redemptionId: string;
  voucherId: string;
  now: Date;
}

export interface FraudFlagPort {
  recordFlashAfterTopUp(params: RecordFlashAfterTopUpParams): Promise<void>;
}
