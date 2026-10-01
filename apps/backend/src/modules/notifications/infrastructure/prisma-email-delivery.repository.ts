import { Injectable } from '@nestjs/common';
import { EmailDelivery as PrismaEmailDelivery } from '@prisma/client';
import { EmailNotificationType } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  EmailDeliveryOutcome,
  EmailDeliveryRecord,
  EmailDeliveryRepositoryPort,
  NewEmailDelivery,
  RETRYABLE_ERROR_PREFIX,
} from '../application/ports/email-delivery.repository.port';

/**
 * Story IR.4b B5/B6: `email_deliveries` through the base client only. The
 * delivery handler runs inside the Outbox dispatcher's transaction, but these
 * writes must commit on their own: the `SENDING` claim before the provider
 * call (AD-10) and the outcome right after it, so neither is lost when the
 * dispatcher's transaction rolls back (e.g. its interactive-transaction
 * timeout during a slow send). Never `currentClient` / `runInTransaction`.
 */
@Injectable()
export class PrismaEmailDeliveryRepository implements EmailDeliveryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByKey(idempotencyKey: string): Promise<EmailDeliveryRecord | null> {
    const row = await this.prisma.emailDelivery.findUnique({
      where: { idempotencyKey },
    });
    return row ? toRecord(row) : null;
  }

  async recordSkippedIfAbsent(
    delivery: NewEmailDelivery,
    lastErrorCode: string,
  ): Promise<boolean> {
    const result = await this.prisma.emailDelivery.createMany({
      data: [{ ...delivery, status: 'SKIPPED', attempts: 0, lastErrorCode }],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async claimSending(
    delivery: NewEmailDelivery,
    now: Date,
    resumeSending: boolean,
  ): Promise<number | null> {
    // INSERT … ON CONFLICT DO NOTHING: exactly one concurrent caller wins.
    const inserted = await this.prisma.emailDelivery.createMany({
      data: [
        { ...delivery, status: 'SENDING', attempts: 1, sendingStartedAt: now },
      ],
      skipDuplicates: true,
    });
    if (inserted.count > 0) return 1;

    // Compare-and-set on an existing row: one statement, so two retries of
    // the same failure cannot both claim it.
    const rows = await this.prisma.$queryRaw<Array<{ attempts: number }>>`
      UPDATE "email_deliveries"
         SET "status" = 'SENDING'::"EmailDeliveryStatus",
             "attempts" = "attempts" + 1,
             "sending_started_at" = ${now},
             "updated_at" = ${now}
       WHERE "idempotency_key" = ${delivery.idempotencyKey}
         AND (
           ("status" = 'FAILED'::"EmailDeliveryStatus"
             AND "last_error_code" LIKE ${`${RETRYABLE_ERROR_PREFIX}%`})
           OR (${resumeSending} AND "status" = 'SENDING'::"EmailDeliveryStatus")
         )
      RETURNING "attempts"`;
    return rows[0]?.attempts ?? null;
  }

  async markUnconfirmed(
    idempotencyKey: string,
    code: string,
  ): Promise<boolean> {
    const result = await this.prisma.emailDelivery.updateMany({
      where: { idempotencyKey, status: 'SENDING' },
      data: { status: 'UNCONFIRMED', lastErrorCode: code },
    });
    return result.count > 0;
  }

  async recordOutcome(
    idempotencyKey: string,
    attempt: number,
    outcome: EmailDeliveryOutcome,
  ): Promise<void> {
    await this.prisma.emailDelivery.updateMany({
      where: {
        idempotencyKey,
        attempts: attempt,
        OR: [
          { status: { in: ['SENDING', 'UNCONFIRMED'] } },
          {
            status: 'FAILED',
            lastErrorCode: { startsWith: RETRYABLE_ERROR_PREFIX },
          },
        ],
      },
      data:
        outcome.status === 'SENT'
          ? {
              status: 'SENT',
              providerMessageId: outcome.providerMessageId,
              sentAt: outcome.sentAt,
              lastErrorCode: null,
            }
          : { status: outcome.status, lastErrorCode: outcome.lastErrorCode },
    });
  }
}

function toRecord(row: PrismaEmailDelivery): EmailDeliveryRecord {
  return {
    idempotencyKey: row.idempotencyKey,
    notificationId: row.notificationId,
    userId: row.userId,
    notificationType: row.notificationType as EmailNotificationType,
    status: row.status,
    attempts: row.attempts,
    providerMessageId: row.providerMessageId,
    lastErrorCode: row.lastErrorCode,
    sendingStartedAt: row.sendingStartedAt,
    sentAt: row.sentAt,
  };
}
