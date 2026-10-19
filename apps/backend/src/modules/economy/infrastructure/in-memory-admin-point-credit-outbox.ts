import {
  adminPointsCreditedPayloadSchema,
  AdminPointsCreditedPayload,
} from '@rescom/schemas';
import { AdminPointCreditOutboxPort } from '../application/ports/admin-point-credit-outbox.port';

export class InMemoryAdminPointCreditOutbox implements AdminPointCreditOutboxPort {
  readonly enqueued: AdminPointsCreditedPayload[] = [];

  async enqueueCredited(payload: AdminPointsCreditedPayload): Promise<void> {
    const validated = adminPointsCreditedPayloadSchema.parse(payload);
    this.enqueued.push(validated);
  }

  clear(): void {
    this.enqueued.length = 0;
  }
}
