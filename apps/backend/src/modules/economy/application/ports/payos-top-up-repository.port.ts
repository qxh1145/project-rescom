import { PayosTopUpDto } from '@rescom/schemas';
import { ProviderPaymentFacts } from './payment-provider.port';

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
  journalId: string | null;
  pointsCredited: number | null;
  amountPaidVnd: number | null;
  providerReference: string | null;
  counterAccountBankId: string | null;
  counterAccountBankName: string | null;
  counterAccountName: string | null;
  counterAccountNumber: string | null;
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
    status: 'CANCELLED' | 'SUCCESSFUL' | 'AMOUNT_MISMATCH' | 'EXPIRED';
    amountPaidVnd?: number;
    occurredAt: string;
  };
}

export interface TopUpAdminAlertEvent {
  id: string;
  idempotencyKey: string;
  eventType: string;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: Record<string, unknown>;
}

export interface TopUpAdminAuditEvent {
  id: string;
  idempotencyKey: string;
  eventType: string;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId?: string | null;
  payload: Record<string, unknown>;
}

export type CreateProcessingResult =
  | { outcome: 'CREATED' | 'ALREADY_PROCESSING'; topUp: PayosTopUp }
  | { outcome: 'RATE_LIMITED'; retryAfterSeconds: number };

export interface ListReconcileCandidatesParams {
  now: Date;
  after?: string;
  limit: number;
}

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
  findByOrderCode(orderCode: number): Promise<PayosTopUp | null>;
  lockForUpdate(id: string): Promise<PayosTopUp | null>;
  markSuccessful(
    id: string,
    data: {
      journalId: string;
      pointsCredited: number;
      facts: ProviderPaymentFacts;
      verifiedAt: Date;
    },
    event: TopUpStatusEvent,
  ): Promise<{ changed: boolean }>;
  markAmountMismatch(
    id: string,
    data: { facts: ProviderPaymentFacts; verifiedAt: Date },
    event: TopUpStatusEvent,
  ): Promise<{ changed: boolean }>;
  findOwned(id: string, userId: string): Promise<PayosTopUp | null>;
  countManualPending(): Promise<number>;

  // Task 3 additions
  listReconcileCandidates(
    params: ListReconcileCandidatesParams,
  ): Promise<PayosTopUp[]>;
  findPayosById(id: string): Promise<PayosTopUp | null>;
  markExpired(
    id: string,
    now: Date,
    event: TopUpStatusEvent,
  ): Promise<{ changed: boolean }>;
  enqueueAdminAlert(event: TopUpAdminAlertEvent): Promise<{ created: boolean }>;
  recordAdminAudit(event: TopUpAdminAuditEvent): Promise<void>;
}
