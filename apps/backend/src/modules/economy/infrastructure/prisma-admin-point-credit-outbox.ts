import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_POINTS_CREDITED_EVENT_TYPE,
  adminPointsCreditedPayloadSchema,
  AdminPointsCreditedPayload,
} from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import { runInTransaction } from '../../../common/database/prisma-unit-of-work';
import { AdminPointCreditOutboxPort } from '../application/ports/admin-point-credit-outbox.port';

@Injectable()
export class PrismaAdminPointCreditOutbox implements AdminPointCreditOutboxPort {
  constructor(private readonly prisma: PrismaService) {}

  async enqueueCredited(payload: AdminPointsCreditedPayload): Promise<void> {
    const validated = adminPointsCreditedPayloadSchema.parse(payload);
    await runInTransaction(this.prisma, async (tx) => {
      await tx.outboxEvent.create({
        data: {
          idempotencyKey: `admin-points-credited:${validated.journalId}`,
          eventType: ADMIN_POINTS_CREDITED_EVENT_TYPE,
          schemaVersion: 1,
          producer: 'economy-service',
          aggregateType: 'LedgerJournal',
          aggregateId: validated.journalId,
          aggregateVersion: 1,
          correlationId: validated.journalId,
          status: 'PENDING',
          payload: validated as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
}
