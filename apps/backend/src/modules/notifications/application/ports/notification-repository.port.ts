import { NotificationType } from '@rescom/schemas';
import { NotificationEntity } from '../../domain/notification.entity';

export const NOTIFICATION_REPOSITORY_PORT = Symbol(
  'NOTIFICATION_REPOSITORY_PORT',
);

export interface CreateNotificationRecord {
  userId: string;
  type: NotificationType;
  message: string;
  dedupeKey: string;
}

export interface NotificationPageQuery {
  limit: number;
  offset: number;
  unreadOnly: boolean;
}

/**
 * Persistence for the Notifications context. Every read/update is scoped to
 * the owning user, so one user can never observe or modify another's rows.
 */
export interface NotificationRepositoryPort {
  /**
   * Inserts the notification unless one already exists for
   * `(userId, dedupeKey)`. Returns `true` when a row was created.
   * Must never join a caller's ambient transaction.
   */
  createIfAbsent(record: CreateNotificationRecord): Promise<boolean>;

  /** Newest first. */
  listForUser(
    userId: string,
    query: NotificationPageQuery,
  ): Promise<NotificationEntity[]>;

  countForUser(
    userId: string,
    filter: { unreadOnly: boolean },
  ): Promise<number>;

  /** Marks one owned, unread notification read. Returns the current row or null when not owned. */
  markRead(
    userId: string,
    notificationId: string,
    readAt: Date,
  ): Promise<NotificationEntity | null>;

  /** Marks every unread notification of the user read. Returns the number changed. */
  markAllRead(userId: string, readAt: Date): Promise<number>;
}
