import { Injectable } from '@nestjs/common';
import { Notification as PrismaNotification } from '@prisma/client';
import { NotificationType } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
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
 */
@Injectable()
export class PrismaNotificationRepository implements NotificationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createIfAbsent(record: CreateNotificationRecord): Promise<boolean> {
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
