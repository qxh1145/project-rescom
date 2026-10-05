import { Injectable } from '@nestjs/common';
import { Notification as PrismaNotification } from '@prisma/client';
import {
  NOTIFICATION_EMAIL_REQUESTED_EVENT,
  NOTIFICATION_EMAIL_REQUESTED_SCHEMA_VERSION,
  NotificationEmailRequestedPayload,
  NotificationType,
  isEmailNotificationType,
  notificationEmailKey,
} from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  afterCommit,
  isInAmbientTransaction,
} from '../../../common/database/prisma-unit-of-work';
import { NotificationEntity } from '../domain/notification.entity';
import {
  CreateNotificationRecord,
  NotificationPageQuery,
  NotificationRepositoryPort,
} from '../application/ports/notification-repository.port';

/**
 * Prisma adapter for the Notifications context.
 *
 * Deliberately uses the base client (never `runInTransaction`): notifications
 * are recorded after the source transaction commits and must not be able to
 * abort it. Every query is scoped by `userId`.
 *
 * Story IR.2b Task 2.4: a publish made inside an ambient Unit of Work (an
 * Outbox handler runs its Economy command in the dispatcher's transaction) is
 * deferred with `afterCommit`, so the notice is written only after — and
 * only if — the source transaction commits (Story 9.6 contract).
 */
@Injectable()
export class PrismaNotificationRepository implements NotificationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createIfAbsent(record: CreateNotificationRecord): Promise<boolean> {
    if (isInAmbientTransaction()) {
      // Reported as created: the deferred insert is idempotent on
      // (user_id, dedupe_key) and a rollback drops it with the source.
      await afterCommit(async () => {
        await this.insertIfAbsent(record);
      }, `notification dedupeKey=${record.dedupeKey}`);
      return true;
    }
    return this.insertIfAbsent(record);
  }

  async createIfAbsentWithEmailRequest(
    record: CreateNotificationRecord,
  ): Promise<boolean> {
    if (isInAmbientTransaction()) {
      await afterCommit(async () => {
        await this.insertWithEmailRequest(record);
      });
      return true;
    }
    return this.insertWithEmailRequest(record);
  }

  /**
   * Story IR.4b B4: notification + `NotificationEmailRequested` in one local
   * transaction; a duplicate (ON CONFLICT DO NOTHING) writes no Outbox row.
   */
  private async insertWithEmailRequest(
    record: CreateNotificationRecord,
  ): Promise<boolean> {
    const type = record.type;
    if (!isEmailNotificationType(type)) return this.insertIfAbsent(record);
    return this.prisma.$transaction(async (tx) => {
      const [created] = await tx.notification.createManyAndReturn({
        data: [
          {
            userId: record.userId,
            type,
            message: record.message,
            dedupeKey: record.dedupeKey,
          },
        ],
        skipDuplicates: true,
        select: { id: true },
      });
      if (!created) return false;
      const payload: NotificationEmailRequestedPayload = {
        schemaVersion: NOTIFICATION_EMAIL_REQUESTED_SCHEMA_VERSION,
        notificationId: created.id,
        userId: record.userId,
        type,
      };
      await tx.outboxEvent.create({
        data: {
          idempotencyKey: notificationEmailKey(created.id),
          eventType: NOTIFICATION_EMAIL_REQUESTED_EVENT,
          schemaVersion: NOTIFICATION_EMAIL_REQUESTED_SCHEMA_VERSION,
          producer: 'notifications-service',
          aggregateType: 'Notification',
          aggregateId: created.id,
          payload,
        },
      });
      return true;
    });
  }

  private async insertIfAbsent(
    record: CreateNotificationRecord,
  ): Promise<boolean> {
    // INSERT ... ON CONFLICT DO NOTHING on (user_id, dedupe_key): a replayed
    // event is a silent no-op instead of a unique-violation error.
    const result = await this.prisma.notification.createMany({
      data: [
        {
          userId: record.userId,
          type: record.type,
          message: record.message,
          dedupeKey: record.dedupeKey,
        },
      ],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async listForUser(
    userId: string,
    query: NotificationPageQuery,
  ): Promise<NotificationEntity[]> {
    const rows = await this.prisma.notification.findMany({
      where: this.ownerFilter(userId, query.unreadOnly),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: query.offset,
      take: query.limit,
    });
    return rows.map((row) => this.toEntity(row));
  }

  async countForUser(
    userId: string,
    filter: { unreadOnly: boolean },
  ): Promise<number> {
    return this.prisma.notification.count({
      where: this.ownerFilter(userId, filter.unreadOnly),
    });
  }

  async markRead(
    userId: string,
    notificationId: string,
    readAt: Date,
  ): Promise<NotificationEntity | null> {
    // Only unread rows change, so an already-read notification keeps its readAt.
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, isRead: false },
      data: { isRead: true, readAt },
    });
    const row = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    return row ? this.toEntity(row) : null;
  }

  async markAllRead(userId: string, readAt: Date): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: this.ownerFilter(userId, true),
      data: { isRead: true, readAt },
    });
    return result.count;
  }

  private ownerFilter(userId: string, unreadOnly: boolean) {
    return unreadOnly ? { userId, isRead: false } : { userId };
  }

  private toEntity(row: PrismaNotification): NotificationEntity {
    return new NotificationEntity({
      id: row.id,
      userId: row.userId,
      type: row.type as NotificationType,
      message: row.message,
      isRead: row.isRead,
      readAt: row.readAt,
      dedupeKey: row.dedupeKey,
      createdAt: row.createdAt,
    });
  }
}
