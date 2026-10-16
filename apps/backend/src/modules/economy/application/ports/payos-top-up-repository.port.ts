import {
  AdminPayosUncredited,
  PayosTopUpDto,
  TopUpRefundEligibility,
  TopUpRefundIneligibleReason,
  TopUpRefundReason,
  TopUpRefundStatus,
} from '@rescom/schemas';
import { ProviderPaymentFacts } from './payment-provider.port';

export const PAYOS_TOP_UP_REPOSITORY_PORT = Symbol(
  'PAYOS_TOP_UP_REPOSITORY_PORT',
);

export interface TopUpRefundRow {
  id: string;
  topUpId: string;
  userId: string;
  topUpJournalId: string;
  holdJournalId: string | null;
  releaseJournalId: string | null;
  status: TopUpRefundStatus;
  eligibility: TopUpRefundEligibility;
  ineligibleReason: TopUpRefundIneligibleReason | null;
  reason: TopUpRefundReason;
  note: string;
  points: number;
  amountVnd: number;
  counterAccountBankId: string | null;
  counterAccountBankName: string | null;
  counterAccountName: string | null;
  counterAccountNumber: string | null;
  destinationVerified: boolean;
  withdrawnAt: Date | null;
  resolvedAt: Date | null;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TopUpRowForRefund {
  id: string;
  userId: string;
  channel: 'PAYOS' | 'MANUAL';
  orderCode: number | null;
  amountVnd: number;
  points: number;
  status: PayosTopUp['status'] | 'PENDING' | 'APPROVED' | 'REJECTED';
  paidAt: Date | null;
  journalId: string | null;
  pointsCredited: number | null;
  amountPaidVnd: number | null;
  counterAccountBankId: string | null;
  counterAccountBankName: string | null;
  counterAccountName: string | null;
  counterAccountNumber: string | null;
  createdAt: Date;
}

export interface UserTopUpRefundSummary {
  id: string;
  status: TopUpRefundStatus;
  eligibility: TopUpRefundEligibility;
  ineligibleReason: TopUpRefundIneligibleReason | null;
  reason: TopUpRefundReason;
  points: number;
  amountVnd: number;
  destination: {
    bankId: string | null;
    bankName: string | null;
    holderName: string | null;
    last4: string | null;
    verified: boolean;
  };
  submittedAt: Date;
  withdrawnAt: Date | null;
}

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
  channel?: 'PAYOS' | 'MANUAL';
  resolutionNote?: string | null;
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
    status:
      | 'CANCELLED'
      | 'SUCCESSFUL'
      | 'AMOUNT_MISMATCH'
      | 'EXPIRED'
      | 'MANUAL_REFUNDED';
    resolution?: 'ADMIN_CREDIT' | 'ADMIN_REFUND';
    remainderVnd?: number;
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

export type AdminPayosRow = Pick<
  PayosTopUp,
  | 'id'
  | 'userId'
  | 'orderCode'
  | 'amountVnd'
  | 'points'
  | 'pointsCredited'
  | 'amountPaidVnd'
  | 'status'
  | 'createdAt'
  | 'paidAt'
  | 'expiresAt'
  | 'cancelledAt'
> & { userEmail: string | null };
export interface AdminPayosListParams {
  status?: PayosTopUp['status'];
  fromUtc?: Date;
  toUtcExclusive?: Date;
  orderCode?: number;
  emailContains?: string;
  limit: number;
  offset: number;
}

export type AdminMismatchRow = AdminPayosRow &
  Pick<PayosTopUp, 'providerReference' | 'counterAccountBankName'> & {
    counterAccountLast4: string | null;
  };

export interface PayosTopUpRepositoryPort {
  listActionRequired(params: { limit: number }): Promise<{
    mismatches: AdminMismatchRow[];
    uncredited: AdminPayosUncredited[];
  }>;
  countActionRequired(): Promise<number>;
  isMismatchJournal(journalId: string, key: string): Promise<boolean>;
  resolveMismatch(
    id: string,
    data: {
      status: 'SUCCESSFUL' | 'MANUAL_REFUNDED';
      expectedAmountPaidVnd: number;
      journalId?: string;
      pointsCredited?: number;
      adminId: string;
      note: string | null;
      correlationId: string | null;
      resolvedAt: Date;
    },
    statusEvent: TopUpStatusEvent,
    auditEvent: TopUpAdminAuditEvent,
  ): Promise<{ changed: boolean }>;
  listForAdmin(
    params: AdminPayosListParams,
  ): Promise<{ items: AdminPayosRow[]; total: number }>;
  listForExport(params: {
    fromUtc: Date;
    toUtcExclusive: Date;
    limit: number;
  }): Promise<AdminPayosRow[]>;
  countByChannel(): Promise<{ payos: number; manual: number }>;

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
  listByUser(
    userId: string,
    options: { limit: number; offset: number },
  ): Promise<{ items: PayosTopUp[]; total: number }>;
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

  // Story 13.10: Refund Request, Refund Hold & Withdrawal
  lockTopUpForRefund(id: string): Promise<TopUpRowForRefund | null>;
  lockRefundRequestByTopUp(topUpId: string): Promise<TopUpRefundRow | null>;
  createRefundRequest(
    data: {
      id: string;
      topUpId: string;
      userId: string;
      topUpJournalId: string;
      holdJournalId: string | null;
      status: TopUpRefundStatus;
      eligibility: TopUpRefundEligibility;
      ineligibleReason: TopUpRefundIneligibleReason | null;
      reason: TopUpRefundReason;
      note: string;
      points: number;
      amountVnd: number;
      counterAccountBankId: string | null;
      counterAccountBankName: string | null;
      counterAccountName: string | null;
      counterAccountNumber: string | null;
      destinationVerified: boolean;
      correlationId: string | null;
      createdAt: Date;
    },
    events: Array<{
      id: string;
      idempotencyKey: string;
      eventType: string;
      producer: string;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      payload: Record<string, unknown>;
    }>,
  ): Promise<TopUpRefundRow>;
  withdrawRefundRequest(
    id: string,
    update: {
      releaseJournalId: string | null;
      withdrawnAt: Date;
    },
    events: Array<{
      id: string;
      idempotencyKey: string;
      eventType: string;
      producer: string;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      payload: Record<string, unknown>;
    }>,
  ): Promise<{ changed: boolean; request: TopUpRefundRow }>;
  findRefundRequestsByTopUpIds(
    topUpIds: string[],
  ): Promise<Map<string, UserTopUpRefundSummary>>;
  findCreditJournal(
    journalId: string,
  ): Promise<{ id: string; idempotencyKey: string; createdAt: Date } | null>;
  findCreditJournalKeysByIds(journalIds: string[]): Promise<Map<string, string>>;
  getUserEmail(userId: string): Promise<string | null>;
}
