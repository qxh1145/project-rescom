import { AdminPointsCreditedPayload } from '@rescom/schemas';

export const ADMIN_POINT_CREDIT_OUTBOX_PORT = Symbol(
  'ADMIN_POINT_CREDIT_OUTBOX_PORT',
);

export interface AdminPointCreditOutboxPort {
  enqueueCredited(payload: AdminPointsCreditedPayload): Promise<void>;
}
