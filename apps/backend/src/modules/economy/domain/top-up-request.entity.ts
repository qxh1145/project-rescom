import { randomUUID } from 'crypto';

export type TopUpRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface TopUpRequestProps {
  id?: string;
  userId: string;
  amount: number;
  amountVnd: number;
  transferReference: string;
  status?: TopUpRequestStatus;
  adminId?: string | null;
  journalId?: string | null;
  rejectionReason?: string | null;
  correlationId?: string | null;
  reviewedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ApproveTopUpProps {
  adminId: string;
  journalId: string;
  correlationId: string;
  reviewedAt: Date;
}

export interface RejectTopUpProps {
  adminId: string;
  reason: string;
  correlationId: string;
  reviewedAt: Date;
}

/**
 * Manual Point top-up request (Story 6.6). `PENDING` is the "Pending Payment"
 * state; the only transitions are `PENDING → APPROVED` and
 * `PENDING → REJECTED`. Instances are immutable: transitions return a copy.
 */
export class TopUpRequestEntity {
  readonly id: string;
  readonly userId: string;
  readonly amount: number;
  readonly amountVnd: number;
  readonly transferReference: string;
  readonly status: TopUpRequestStatus;
  readonly adminId: string | null;
  readonly journalId: string | null;
  readonly rejectionReason: string | null;
  readonly correlationId: string | null;
  readonly reviewedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: TopUpRequestProps) {
    const now = new Date();
    this.id = props.id ?? randomUUID();
    this.userId = props.userId;
    this.amount = props.amount;
    this.amountVnd = props.amountVnd;
    this.transferReference = props.transferReference;
    this.status = props.status ?? 'PENDING';
    this.adminId = props.adminId ?? null;
    this.journalId = props.journalId ?? null;
    this.rejectionReason = props.rejectionReason ?? null;
    this.correlationId = props.correlationId ?? null;
    this.reviewedAt = props.reviewedAt ?? null;
    this.createdAt = props.createdAt ?? now;
    this.updatedAt = props.updatedAt ?? this.createdAt;
  }

  static create(
    props: Omit<
      TopUpRequestProps,
      | 'status'
      | 'adminId'
      | 'journalId'
      | 'rejectionReason'
      | 'correlationId'
      | 'reviewedAt'
    >,
  ): TopUpRequestEntity {
    if (!Number.isInteger(props.amount) || props.amount <= 0) {
      throw new Error('Top-up amount must be a positive integer.');
    }
    return new TopUpRequestEntity({ ...props, status: 'PENDING' });
  }

  isPending(): boolean {
    return this.status === 'PENDING';
  }

  approve(props: ApproveTopUpProps): TopUpRequestEntity {
    this.assertPending();
    return new TopUpRequestEntity({
      ...this.toProps(),
      status: 'APPROVED',
      adminId: props.adminId,
      journalId: props.journalId,
      correlationId: props.correlationId,
      reviewedAt: props.reviewedAt,
      updatedAt: props.reviewedAt,
    });
  }

  reject(props: RejectTopUpProps): TopUpRequestEntity {
    this.assertPending();
    return new TopUpRequestEntity({
      ...this.toProps(),
      status: 'REJECTED',
      adminId: props.adminId,
      rejectionReason: props.reason,
      correlationId: props.correlationId,
      reviewedAt: props.reviewedAt,
      updatedAt: props.reviewedAt,
    });
  }

  toProps(): TopUpRequestProps {
    return {
      id: this.id,
      userId: this.userId,
      amount: this.amount,
      amountVnd: this.amountVnd,
      transferReference: this.transferReference,
      status: this.status,
      adminId: this.adminId,
      journalId: this.journalId,
      rejectionReason: this.rejectionReason,
      correlationId: this.correlationId,
      reviewedAt: this.reviewedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  private assertPending(): void {
    if (!this.isPending()) {
      throw new Error(
        `Top-up request ${this.id} is ${this.status} and can no longer be reviewed.`,
      );
    }
  }
}
