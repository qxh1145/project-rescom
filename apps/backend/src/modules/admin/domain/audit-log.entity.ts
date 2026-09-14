export interface AuditLogProps {
  id: string;
  action: string;
  userId?: string | null;
  targetUserId?: string | null;
  outcome: 'SUCCESS' | 'FAILURE';
  errorCode?: string | null;
  metadata?: Record<string, unknown> | unknown[] | null;
  createdAt: Date;
}

export class AuditLog {
  readonly id: string;
  readonly action: string;
  readonly userId: string | null;
  readonly targetUserId: string | null;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly errorCode: string | null;
  readonly metadata: Record<string, unknown> | unknown[] | null;
  readonly createdAt: Date;

  constructor(props: AuditLogProps) {
    this.id = props.id;
    this.action = props.action;
    this.userId = props.userId ?? null;
    this.targetUserId = props.targetUserId ?? null;
    this.outcome = props.outcome;
    this.errorCode = props.errorCode ?? null;
    if (props.metadata && typeof props.metadata === 'object') {
      this.metadata = Object.freeze({ ...props.metadata });
    } else {
      this.metadata = props.metadata ?? null;
    }
    this.createdAt = props.createdAt;
    Object.freeze(this);
  }
}
