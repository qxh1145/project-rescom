import { PayosTopUpDto } from '@rescom/schemas';

export const PAYOS_TOP_UP_REPOSITORY_PORT = Symbol(
  'PAYOS_TOP_UP_REPOSITORY_PORT',
);
export interface PayosTopUp {
  id: string;
  userId: string;
  orderCode: number;
  amountVnd: number;
  points: number;
  status: PayosTopUpDto['status'];
  checkoutUrl: string | null;
  paymentLinkId: string | null;
  expiresAt: Date;
  cancelledAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}
export interface TopUpStatusEvent {
  id: string;
  idempotencyKey: string;
  eventType: string;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: {
    schemaVersion: 1;
    topUpId: string;
    userId: string;
    orderCode: number;
    amountVnd: number;
    points: number;
    status: 'CANCELLED';
    occurredAt: string;
  };
}
export type CreateProcessingResult =
  | { outcome: 'CREATED' | 'ALREADY_PROCESSING'; topUp: PayosTopUp }
  | { outcome: 'RATE_LIMITED'; retryAfterSeconds: number };
export interface PayosTopUpRepositoryPort {
  createProcessing(
    input: Pick<
      PayosTopUp,
      'id' | 'userId' | 'amountVnd' | 'points' | 'expiresAt' | 'createdAt'
    >,
    options: { limit: number; windowMs: number; now: Date },
  ): Promise<CreateProcessingResult>;
  attachPaymentLink(
    id: string,
    link: { paymentLinkId: string; checkoutUrl: string },
  ): Promise<PayosTopUp>;
  markCancelled(
    id: string,
    cancelledAt: Date,
    event: TopUpStatusEvent | null,
  ): Promise<{ changed: boolean; topUp: PayosTopUp }>;
  findOwned(id: string, userId: string): Promise<PayosTopUp | null>;
  listByUser(
    userId: string,
    options: { limit: number; offset: number },
  ): Promise<{ items: PayosTopUp[]; total: number }>;
  countManualPending(): Promise<number>;
}

