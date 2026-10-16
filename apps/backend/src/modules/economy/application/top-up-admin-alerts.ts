import { randomUUID } from 'crypto';
import {
  TOP_UP_ADMIN_ALERT_EVENT_TYPE,
  TopUpAdminAlertCondition,
  topUpAdminAlertEventSchema,
  topUpAlertKey,
} from '@rescom/schemas';
import {
  PayosTopUpRepositoryPort,
  TopUpAdminAlertEvent,
} from './ports/payos-top-up-repository.port';

export interface TopUpAdminAlertDetails {
  topUpId?: string;
  orderCode?: number;
  amountVnd?: number;
  amountPaidVnd?: number;
  paidAt?: string;
}

export class TopUpAdminAlerts {
  constructor(
    private readonly repository: Pick<
      PayosTopUpRepositoryPort,
      'enqueueAdminAlert'
    >,
    private readonly clock: () => Date = () => new Date(),
    private readonly generateId: () => string = () => randomUUID(),
  ) {}

  async raise(
    condition: TopUpAdminAlertCondition,
    subject: string,
    details?: TopUpAdminAlertDetails,
  ): Promise<boolean> {
    const occurredAt = this.clock().toISOString();
    const payload = topUpAdminAlertEventSchema.parse({
      schemaVersion: 1,
      condition,
      topUpId: details?.topUpId,
      orderCode: details?.orderCode,
      amountVnd: details?.amountVnd,
      amountPaidVnd: details?.amountPaidVnd,
      paidAt: details?.paidAt,
      occurredAt,
    });

    const event: TopUpAdminAlertEvent = {
      id: this.generateId(),
      idempotencyKey: topUpAlertKey(condition, subject),
      eventType: TOP_UP_ADMIN_ALERT_EVENT_TYPE,
      producer: 'economy-service',
      aggregateType: 'TopUpAdminAlert',
      aggregateId: details?.topUpId ?? subject,
      aggregateVersion: 1,
      payload: payload as unknown as Record<string, unknown>,
    };

    const { created } = await this.repository.enqueueAdminAlert(event);
    return created;
  }
}
