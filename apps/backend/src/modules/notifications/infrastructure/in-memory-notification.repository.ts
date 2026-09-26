import { NotificationEntity } from '../domain/notification.entity';
import {
  CreateNotificationRecord,
  NotificationPageQuery,
  NotificationRepositoryPort,
} from '../application/ports/notification-repository.port';

/**
 * In-memory adapter used by unit tests and e2e overrides. Mirrors the Prisma
 * adapter semantics: `(userId, dedupeKey)` uniqueness, owner-scoped queries,
 * newest-first ordering.
 */
export class InMemoryNotificationRepository implements NotificationRepositoryPort {
  private readonly rows: Array<{ seq: number; entity: NotificationEntity }> =
    [];
  private sequence = 0;

  async createIfAbsent(record: CreateNotificationRecord): Promise<boolean> {
    const exists = this.rows.some(
      (row) =>
        row.entity.userId === record.userId &&
        row.entity.dedupeKey === record.dedupeKey,
    );
    if (exists) {
      return false;
    }
    this.rows.push({
      seq: this.sequence++,
      entity: new NotificationEntity({
        userId: record.userId,
        type: record.type,
        message: record.message,
        dedupeKey: record.dedupeKey,
      }),
    });
    return true;
  }

  async listForUser(
    userId: string,
    query: NotificationPageQuery,
  ): Promise<NotificationEntity[]> {
    return this.ownedRows(userId, query.unreadOnly)
      .sort(
        (a, b) =>
          b.entity.createdAt.getTime() - a.entity.createdAt.getTime() ||
          b.seq - a.seq,
      )
      .slice(query.offset, query.offset + query.limit)
      .map((row) => row.entity);
  }

  async countForUser(
    userId: string,
    filter: { unreadOnly: boolean },
  ): Promise<number> {
    return this.ownedRows(userId, filter.unreadOnly).length;
  }

  async markRead(
    userId: string,
    notificationId: string,
    readAt: Date,
  ): Promise<NotificationEntity | null> {
    const row = this.rows.find(
      (r) => r.entity.id === notificationId && r.entity.userId === userId,
    );
    if (!row) {
      return null;
    }
    row.entity = row.entity.markRead(readAt);
    return row.entity;
  }

  async markAllRead(userId: string, readAt: Date): Promise<number> {
    let updated = 0;
    for (const row of this.ownedRows(userId, true)) {
      row.entity = row.entity.markRead(readAt);
      updated++;
    }
    return updated;
  }

  /** Test helper: every stored notification, oldest first. */
  all(): NotificationEntity[] {
    return this.rows.map((row) => row.entity);
  }

  clear(): void {
    this.rows.length = 0;
  }

  private ownedRows(userId: string, unreadOnly: boolean) {
    return this.rows.filter(
      (row) =>
        row.entity.userId === userId && (!unreadOnly || !row.entity.isRead),
    );
  }
}
